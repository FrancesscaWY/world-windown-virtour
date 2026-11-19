/** Equirectangular WebGL viewer. Angles use radians, except field of view (degrees). */
export const PANORAMA_LIMITS = Object.freeze({ minFov: 35, maxFov: 100, maxPitch: 1.48 });
export const PANORAMA_RENDER_LIMITS = Object.freeze({ maxDpr: 1.5, maxPixels: 2_000_000, maxCubeFace: 2048, maxImageWidth: 4096 });
const INITIAL_VIEW = Object.freeze({ yaw: 0, pitch: 0.08, fov: 65 });
const TAU = Math.PI * 2;
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function normalizePanoramaView(view = {}) {
  const yaw = finite(view.yaw, INITIAL_VIEW.yaw);
  return {
    yaw: ((yaw + Math.PI) % TAU + TAU) % TAU - Math.PI,
    pitch: clamp(finite(view.pitch, INITIAL_VIEW.pitch), -PANORAMA_LIMITS.maxPitch, PANORAMA_LIMITS.maxPitch),
    fov: clamp(finite(view.fov, INITIAL_VIEW.fov), PANORAMA_LIMITS.minFov, PANORAMA_LIMITS.maxFov),
  };
}

/** Project a spherical hotspot into canvas CSS pixels, using the same camera as the shader. */
export function projectPanoramaHotspot(point, view, viewport) {
  const width = finite(viewport?.width, 0);
  const height = finite(viewport?.height, 0);
  const hidden = { visible: false, x: null, y: null, normalizedX: null, normalizedY: null };
  if (width <= 0 || height <= 0 || !Number.isFinite(point?.yaw) || !Number.isFinite(point?.pitch)) return hidden;
  const camera = normalizePanoramaView(view);
  const horizontal = Math.cos(point.pitch);
  const worldX = Math.sin(point.yaw) * horizontal;
  const worldY = Math.sin(point.pitch);
  const worldZ = Math.cos(point.yaw) * horizontal;
  // Inverse yaw, then inverse pitch: the inverse of the renderer's camera rotation.
  const x = Math.cos(camera.yaw) * worldX - Math.sin(camera.yaw) * worldZ;
  const y = worldY;
  const z = Math.sin(camera.yaw) * worldX + Math.cos(camera.yaw) * worldZ;
  const cameraY = Math.cos(camera.pitch) * y - Math.sin(camera.pitch) * z;
  const cameraZ = Math.sin(camera.pitch) * y + Math.cos(camera.pitch) * z;
  if (cameraZ <= 0.0001) return hidden;
  const tangent = Math.tan(camera.fov * Math.PI / 360);
  const ndcX = x / (cameraZ * tangent * width / height);
  const ndcY = cameraY / (cameraZ * tangent);
  const normalizedX = (ndcX + 1) / 2;
  const normalizedY = (1 - ndcY) / 2;
  return {
    visible: Math.abs(ndcX) <= 1 && Math.abs(ndcY) <= 1,
    x: normalizedX * width,
    y: normalizedY * height,
    normalizedX,
    normalizedY,
  };
}

/**
 * Returns an idempotent cleanup function with moveTo(view), cancelMove(), zoomBy(degrees), reset(), getView(),
 * projectHotspot({yaw,pitch}) and setOnViewChange(callback). Positive zoomBy zooms out.
 * onStatus receives loading/ready/error/unsupported and an optional reason object.
 */
export function mountPanorama(canvas, source, onStatus = () => {}) {
  // A panorama can be a regular equirectangular image URL, or a six-face
  // Cubemap. Cubemap face order follows WebGL's +X, -X, +Y, -Y, +Z, -Z axes.
  let cubemapSources = source?.kind === 'cubemap' && Array.isArray(source.faces) && source.faces.length === 6 ? source.faces : null;
  const isCubemap = Boolean(cubemapSources);
  let disposed = false;
  let contextLost = false;
  let loaded = false;
  let status = 'loading';
  const initialView = normalizePanoramaView(source?.initialView ?? INITIAL_VIEW);
  let view = { ...initialView };
  let viewListener = null;
  let resources = null;
  let image = null;
  let images = [];
  let imageReady = false;
  let observer = null;
  let timeout = null;
  let gl = null;
  let gesture = null;
  let flight = null;
  let renderFrame = null;
  let size = { width: 0, height: 0 };
  const pointers = new Map();
  const listeners = [];
  const originalTouchAction = canvas.style.touchAction;
  const hadTabindex = canvas.hasAttribute('tabindex');
  const originalTabindex = canvas.getAttribute('tabindex');
  measureViewport();

  function report(next, reason) {
    if (disposed) return;
    status = next;
    onStatus(next, reason ? { reason } : undefined);
  }

  function measureViewport() {
    const rect = canvas.getBoundingClientRect();
    size = { width: Math.max(0, rect.width), height: Math.max(0, rect.height) };
  }

  function viewport() {
    return size;
  }

  function getView() {
    return { ...view, ...viewport(), ready: loaded && !contextLost && !disposed, status };
  }

  function removeResources() {
    if (!gl || !resources) return;
    const { texture, buffer, program, vertexShader, fragmentShader } = resources;
    if (texture) gl.deleteTexture(texture);
    if (buffer) gl.deleteBuffer(buffer);
    if (program) gl.deleteProgram(program);
    if (vertexShader) gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
    resources = null;
  }

  function cleanup() {
    if (disposed) return;
    cancelMove();
    cancelRender();
    disposed = true;
    loaded = false;
    clearTimeout(timeout);
    observer?.disconnect();
    for (const [target, type, handler, options] of listeners) target.removeEventListener(type, handler, options);
    for (const id of pointers.keys()) {
      try { if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id); } catch { /* Capture may already be released. */ }
    }
    pointers.clear();
    if (image) { image.onload = null; image.onerror = null; image.src = ''; }
    image = null;
    for (const item of images) {
      item.onload = null; item.onerror = null; item.src = '';
    }
    images = [];
    imageReady = false;
    viewListener = null;
    removeResources();
    // Keep the reusable context, but do not retain a large hidden drawing buffer.
    if (gl) { canvas.width = 1; canvas.height = 1; }
    if (canvas.style.touchAction === 'none') canvas.style.touchAction = originalTouchAction;
    if (!hadTabindex && canvas.getAttribute('tabindex') === '0') canvas.removeAttribute('tabindex');
    else if (hadTabindex && canvas.getAttribute('tabindex') === '0') canvas.setAttribute('tabindex', originalTabindex);
  }

  function change(next) {
    if (disposed) return getView();
    cancelMove();
    view = normalizePanoramaView(next);
    update();
    return getView();
  }

  function cancelMove() {
    if (!flight) return;
    const current = flight; flight = null;
    globalThis.cancelAnimationFrame?.(current.frame);
    current.resolve(false);
  }

  function moveTo(next, { duration = 1000 } = {}) {
    cancelMove();
    cancelRender();
    if (disposed || !loaded || contextLost) return Promise.resolve(false);
    const target = normalizePanoramaView(next);
    const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const ms = reduced ? 0 : clamp(finite(duration, 1000), 0, 3000);
    if (!ms || !globalThis.requestAnimationFrame) { change(target); return Promise.resolve(true); }
    const start = { ...view };
    const deltaYaw = normalizePanoramaView({ yaw: target.yaw - start.yaw }).yaw;
    return new Promise(resolve => {
      const current = { resolve, frame: null, started: null }; flight = current;
      const step = time => {
        if (flight !== current || disposed) return;
        current.started ??= time;
        const progress = Math.min(1, (time - current.started) / ms);
        const eased = progress * progress * (3 - 2 * progress);
        view = normalizePanoramaView({ yaw: start.yaw + deltaYaw * eased,
          pitch: start.pitch + (target.pitch - start.pitch) * eased, fov: start.fov + (target.fov - start.fov) * eased });
        // The flight already runs on RAF; do not queue a second animation loop.
        flushUpdate();
        if (flight !== current) return;
        if (progress === 1) { flight = null; resolve(true); }
        else current.frame = requestAnimationFrame(step);
      };
      current.frame = requestAnimationFrame(step);
    });
  }

  Object.assign(cleanup, {
    moveTo, cancelMove,
    zoomBy: (delta) => change({ ...view, fov: view.fov + finite(delta, 0) }),
    reset: () => change(initialView),
    getView,
    projectHotspot: (point) => projectPanoramaHotspot(point, view, viewport()),
    setOnViewChange: (callback) => {
      if (disposed) return;
      viewListener = typeof callback === 'function' ? callback : null;
      viewListener?.(getView());
    },
  });

  if (source?.kind === 'cubemap' && !cubemapSources) {
    report('error', 'cubemap-source-invalid');
    return cleanup;
  }
  // A full-screen textured quad has no geometry edges to multisample.
  try { gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false }); } catch { /* Unsupported contexts may throw. */ }
  if (!gl) { report('unsupported', 'webgl-unavailable'); return cleanup; }
  if (isCubemap && Array.isArray(source.mobileFaces) && source.mobileFaces.length === 6 &&
    (size.width < 768 || gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE) < PANORAMA_RENDER_LIMITS.maxCubeFace)) {
    cubemapSources = source.mobileFaces;
  }

  const vertex = `attribute vec2 position; varying vec2 uv; void main(){uv=(position+1.0)*0.5;gl_Position=vec4(position,0.0,1.0);}`;
  const fragment = isCubemap ? `precision mediump float;
    varying vec2 uv; uniform samplerCube panorama; uniform float aspect; uniform float yaw; uniform float pitch; uniform float fov;
    void main(){
      vec2 xy=(uv*2.0-1.0)*vec2(aspect,1.0)*tan(fov*0.5);
      vec3 r=normalize(vec3(xy,1.0));
      r=vec3(r.x,cos(pitch)*r.y+sin(pitch)*r.z,-sin(pitch)*r.y+cos(pitch)*r.z);
      r=vec3(cos(yaw)*r.x+sin(yaw)*r.z,r.y,-sin(yaw)*r.x+cos(yaw)*r.z);
      gl_FragColor=textureCube(panorama,r);
    }` : `precision mediump float;
    varying vec2 uv; uniform sampler2D panorama; uniform float aspect; uniform float yaw; uniform float pitch; uniform float fov;
    void main(){
      vec2 xy=(uv*2.0-1.0)*vec2(aspect,1.0)*tan(fov*0.5);
      vec3 r=normalize(vec3(xy,1.0));
      r=vec3(r.x,cos(pitch)*r.y+sin(pitch)*r.z,-sin(pitch)*r.y+cos(pitch)*r.z);
      r=vec3(cos(yaw)*r.x+sin(yaw)*r.z,r.y,-sin(yaw)*r.x+cos(yaw)*r.z);
      vec2 sphere=vec2(0.5+atan(r.x,r.z)/6.283185307,0.5+asin(clamp(r.y,-1.0,1.0))/3.141592654);
      gl_FragColor=texture2D(panorama,sphere);
    }`;

  function initialize() {
    resources = {};
    function shader(type, code, name) {
      const result = gl.createShader(type);
      resources[name] = result;
      if (!result) throw new Error('Shader unavailable');
      gl.shaderSource(result, code);
      gl.compileShader(result);
      if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error('Shader failed');
      return result;
    }
    const vertexShader = shader(gl.VERTEX_SHADER, vertex, 'vertexShader');
    const fragmentShader = shader(gl.FRAGMENT_SHADER, fragment, 'fragmentShader');
    const program = gl.createProgram();
    resources.program = program;
    if (!program) throw new Error('Program unavailable');
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Link failed');
    gl.useProgram(program);
    resources.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    resources.texture = gl.createTexture();
    if (!resources.buffer || !resources.texture) throw new Error('Resources unavailable');
    resources.uniforms = Object.fromEntries(['aspect', 'yaw', 'pitch', 'fov'].map((name) => [name, gl.getUniformLocation(program, name)]));
    gl.uniform1i(gl.getUniformLocation(program, 'panorama'), 0);
  }

  function draw() {
    if (disposed || contextLost || !loaded || !resources) return;
    const { width, height } = viewport();
    if (!width || !height) return;
    const dpr = Math.min(clamp(finite(globalThis.devicePixelRatio, 1), 1, PANORAMA_RENDER_LIMITS.maxDpr),
      Math.sqrt(PANORAMA_RENDER_LIMITS.maxPixels / (width * height)));
    const w = Math.max(1, Math.floor(width * dpr));
    const h = Math.max(1, Math.floor(height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.useProgram(resources.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(isCubemap ? gl.TEXTURE_CUBE_MAP : gl.TEXTURE_2D, resources.texture);
    gl.uniform1f(resources.uniforms.aspect, width / height);
    gl.uniform1f(resources.uniforms.yaw, view.yaw);
    gl.uniform1f(resources.uniforms.pitch, view.pitch);
    gl.uniform1f(resources.uniforms.fov, view.fov * Math.PI / 180);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function update() {
    if (disposed || flight) return; // An active flight will draw the latest size/state on its next frame.
    // Pointer/wheel events may arrive much faster than the screen refresh rate.
    if (!globalThis.requestAnimationFrame) { flushUpdate(); return; }
    if (renderFrame !== null) return;
    renderFrame = requestAnimationFrame(() => { renderFrame = null; flushUpdate(); });
  }

  function cancelRender() {
    if (renderFrame !== null) globalThis.cancelAnimationFrame?.(renderFrame);
    renderFrame = null;
  }

  function flushUpdate() {
    cancelRender();
    if (disposed) return;
    draw();
    viewListener?.(getView());
  }

  function textureImage(input, limit) {
    const width = input.naturalWidth, height = input.naturalHeight;
    if (!width || !height || Math.max(width, height) <= limit) return input;
    const scaled = document.createElement('canvas');
    const ratio = Math.min(1, limit / Math.max(width, height));
    scaled.width = Math.max(1, Math.round(width * ratio));
    scaled.height = Math.max(1, Math.round(height * ratio));
    scaled.getContext('2d').drawImage(input, 0, 0, scaled.width, scaled.height);
    return scaled;
  }

  function upload() {
    if (disposed || contextLost || !imageReady || !resources) return;
    try {
      gl.activeTexture(gl.TEXTURE0);
      const target = isCubemap ? gl.TEXTURE_CUBE_MAP : gl.TEXTURE_2D;
      gl.bindTexture(target, resources.texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, !isCubemap);
      const limit = Math.min(isCubemap ? PANORAMA_RENDER_LIMITS.maxCubeFace : PANORAMA_RENDER_LIMITS.maxImageWidth,
        gl.getParameter(isCubemap ? gl.MAX_CUBE_MAP_TEXTURE_SIZE : gl.MAX_TEXTURE_SIZE));
      if (isCubemap) {
        for (const [index, face] of images.entries()) {
          gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + index, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textureImage(face, limit));
        }
      } else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textureImage(image, limit));
      // CLAMP also supports non-power-of-two photographs on WebGL 1.
      gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      if (gl.getError() !== gl.NO_ERROR) throw new Error('Texture failed');
      loaded = true;
      report('ready');
      update();
    } catch {
      loaded = false;
      report('error', 'texture-upload-failed');
      update();
    }
  }

  try { initialize(); } catch {
    removeResources();
    report('unsupported', 'webgl-initialization-failed');
    return cleanup;
  }

  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    listeners.push([target, type, handler, options]);
  }

  function measureGesture() {
    const entries = [...pointers.values()];
    if (!entries.length) return null;
    if (entries.length === 1) return { x: entries[0].x, y: entries[0].y, distance: null };
    const [a, b] = entries;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
  }

  canvas.style.touchAction = 'none';
  if (!hadTabindex) canvas.setAttribute('tabindex', '0');
  listen(canvas, 'pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    cancelMove();
    cancelRender();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    gesture = measureGesture();
    try { canvas.setPointerCapture(event.pointerId); canvas.focus({ preventScroll: true }); } catch { /* Capture is an enhancement. */ }
  });
  listen(canvas, 'pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    event.preventDefault();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const next = measureGesture();
    if (!gesture || !next) { gesture = next; return; }
    const sensitivity = view.fov * Math.PI / (180 * Math.max(1, viewport().height));
    const fov = gesture.distance > 0 && next.distance > 0 ? view.fov * gesture.distance / next.distance : view.fov;
    change({ yaw: view.yaw - (next.x - gesture.x) * sensitivity, pitch: view.pitch + (next.y - gesture.y) * sensitivity, fov });
    gesture = next;
  });
  const release = (event) => {
    pointers.delete(event.pointerId);
    gesture = measureGesture();
    try { if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); } catch { /* Pointer may have left the document. */ }
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(canvas, type, release);
  listen(canvas, 'wheel', (event) => {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport().height : 1;
    cleanup.zoomBy(event.deltaY * unit * 0.03);
  }, { passive: false });
  listen(canvas, 'keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_', 'Home', '0'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home' || event.key === '0') { cleanup.reset(); return; }
    if (['+', '=', '-', '_'].includes(event.key)) { cleanup.zoomBy(['+', '='].includes(event.key) ? -5 : 5); return; }
    change({ ...view, yaw: view.yaw + (event.key === 'ArrowLeft' ? -0.08 : event.key === 'ArrowRight' ? 0.08 : 0), pitch: view.pitch + (event.key === 'ArrowUp' ? 0.08 : event.key === 'ArrowDown' ? -0.08 : 0) });
  });
  listen(canvas, 'webglcontextlost', (event) => {
    event.preventDefault();
    cancelMove();
    contextLost = true;
    loaded = false;
    pointers.clear();
    gesture = null;
    report('error', 'webgl-context-lost');
    update();
  });
  listen(canvas, 'webglcontextrestored', () => {
    contextLost = false;
    // Old handles become invalid after a lost context; construct fresh resources.
    resources = null;
    try { initialize(); report('loading'); upload(); } catch {
      removeResources();
      report('error', 'webgl-restore-failed');
    }
  });
  function resize(entries) {
    const rect = entries?.[0]?.contentRect;
    if (rect) size = { width: Math.max(0, rect.width), height: Math.max(0, rect.height) };
    else measureViewport();
    update();
  }
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(resize);
    observer.observe(canvas);
  } else if (globalThis.addEventListener) listen(globalThis, 'resize', resize);
  const failImage = () => {
    clearTimeout(timeout);
    imageReady = false;
    loaded = false;
    report('error', isCubemap ? 'cubemap-face-load-failed' : 'image-load-failed');
    update();
  };
  report('loading');
  timeout = setTimeout(() => {
    if (disposed || imageReady) return;
    if (image) { image.onload = null; image.onerror = null; }
    for (const item of images) { item.onload = null; item.onerror = null; }
    report('error', isCubemap ? 'cubemap-load-timeout' : 'image-load-timeout');
    update();
  }, 20000);
  if (isCubemap) {
    // Create the whole collection before assigning URLs (cached images can load quickly).
    images = cubemapSources.map(() => new Image());
    images.forEach((face, index) => {
      face.crossOrigin = 'anonymous';
      face.decoding = 'async';
      face.onload = () => {
        if (disposed || imageReady || !images.every(item => item.complete && item.naturalWidth > 0)) return;
        clearTimeout(timeout);
        imageReady = true;
        upload();
      };
      face.onerror = failImage;
      face.src = cubemapSources[index];
    });
  } else {
    image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => {
      if (disposed) return;
      clearTimeout(timeout);
      imageReady = true;
      upload();
    };
    image.onerror = failImage;
    image.src = source;
  }
  return cleanup;
}
