import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {zipSync, unzipSync, strToU8} from 'fflate';

// One reviewed Markdown source produces the print PDF and editable OOXML Word.
// No new dependency, external document service, or model call is needed.
const root=fileURLToPath(new URL('../',import.meta.url));
const docs=`${root}docs`;
const stem='VirTour-产品与技术文档';
const source=await readFile(`${docs}/PRODUCT_TECHNOLOGY.md`,'utf8');
const pages=source.split(/\s*<!-- page -->\s*/).map(parse);
assert.equal(pages.length,3);
const module=process.env.VIRTOUR_PLAYWRIGHT_PATH??'/root/.npm/_npx/420ff84f11983ee5/node_modules/playwright/index.mjs';
const {chromium}=await import(module);
const browser=await chromium.launch({
  executablePath:process.env.CHROME_PATH??'/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome',
  args:['--no-sandbox','--enable-unsafe-swiftshader'],
});
const assets=`${docs}/assets/product-technology`;
await mkdir(assets,{recursive:true});
await mkdir(`${root}agent-tmp/product-technology`,{recursive:true});
try {
  if(process.argv.includes('--capture')){
    // UI-only captures: no fabricated dialogue, microphone, paid model or TTS.
    const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,reducedMotion:'reduce'});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${process.env.DEMO_URL??'http://127.0.0.1:5174/'}tour.html?mode=interactive`);
    await page.waitForFunction(()=>document.querySelector('#companion-pet')?.getAttribute('aria-busy')==='false'&&document.querySelector('.map-base')?.naturalWidth>0);
    await page.screenshot({path:`${assets}/interactive.png`});
    await page.locator('#mode-button').click();
    await page.locator('[data-tour-mode="companion"]').click();
    await page.screenshot({path:`${assets}/companion.png`});
    await page.locator('#mode-button').click();
    await page.locator('[data-tour-mode="interactive"]').click();
    await page.evaluate(async()=>{
      const {store}=await import('/src/guide/store.js');
      store.set({view:'panorama',selectedPoiId:'eiffel'});
    });
    await page.waitForFunction(()=>document.querySelector('#panorama-canvas')?.getAttribute('aria-busy')==='false');
    await page.screenshot({path:`${assets}/panorama.png`});
    assert.deepEqual(errors,[]);
    await page.close();
  }
  const imageFiles=[...new Set(pages.flatMap(page=>page.filter(b=>b.kind==='gallery').flatMap(b=>b.images.map(i=>i.path))))];
  const images=new Map();
  for(const path of imageFiles){
    assert.ok(path.startsWith('assets/product-technology/'));
    const bytes=await readFile(`${docs}/${path}`);
    const metadata=await sharp(bytes).metadata();
    assert.equal(metadata.format,'png');
    images.set(path,{bytes,width:metadata.width,height:metadata.height});
  }
  const logo=`data:image/png;base64,${(await readFile(`${root}public/assets/brand-logo.png`)).toString('base64')}`;
  const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>VirTour 产品与技术文档</title><style>
    @page {size:A4;margin:0}
    *{box-sizing:border-box}
    html,body{margin:0;padding:0}
    body{font-family:"WenQuanYi Zen Hei","Microsoft YaHei",sans-serif;color:#2c3942;background:#edf1f4;font-size:10.1pt;line-height:1.53;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .paper{position:relative;width:210mm;height:297mm;padding:13mm 16mm 15mm;background:white;margin:7mm auto;break-after:page}
    .paper:last-child{break-after:auto}
    .masthead{display:flex;align-items:center;gap:2mm;padding-bottom:2mm;margin-bottom:3.2mm;border-bottom:1px solid #cbdce7;color:#456b86;font-size:8.5pt}
    .masthead img{width:7mm;height:7mm}.masthead span:last-child{margin-left:auto;color:#7a8b96;font-size:7.8pt}
    h1{font-size:20pt;line-height:1.25;color:#344f63;margin:0 0 2mm;letter-spacing:.5pt}
    h2{font-size:13pt;line-height:1.35;color:#345975;margin:4mm 0 2.2mm}
    h3{font-size:10.5pt;color:#345975;margin:3mm 0 1.4mm}
    p{margin:0 0 2.5mm;text-align:justify;overflow-wrap:anywhere}
    .meta{font-size:8pt;color:#778791;margin-bottom:4mm}
    strong{font-weight:700;color:#324b5c}code{font-family:"DejaVu Sans Mono","WenQuanYi Zen Hei",monospace;font-size:.84em}
    .list-item{padding-left:3mm;text-indent:-3mm;margin-bottom:2.2mm}
    .gallery{display:flex;justify-content:space-around;gap:3mm;margin:3mm 0 1mm}
    figure{margin:0;flex:1;text-align:center;min-width:0}
    figure img{height:75mm;width:auto;max-width:100%;object-fit:contain;border:1px solid #dce4e9;border-radius:2mm}
    figcaption{font-size:7.4pt;color:#647b8b;line-height:1.4;max-width:50mm;margin:1mm auto 0}
    .caption{font-size:7.7pt;color:#75848e;margin:1mm 0 3mm}
    table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:8.5pt;line-height:1.43;margin:2mm 0 3mm}
    th,td{padding:2mm 2.1mm;vertical-align:top;border:1px solid #d7e0e6;overflow-wrap:anywhere;text-align:left}
    th{color:#345975;background:#eaf1f6;font-weight:700}
    th:first-child,td:first-child{width:23%}th:nth-child(2),td:nth-child(2){width:36%}
    .references{font-size:7.1pt;line-height:1.38;color:#627480;margin:0 0 1mm;overflow-wrap:anywhere;text-align:left}
    .reference-title{font-size:8.2pt;margin:2mm 0 1.3mm}
    .evidence{font-size:7.1pt;line-height:1.4;color:#6a7c87;margin-top:2mm}
    a{color:inherit;text-decoration:none}
    footer{position:absolute;bottom:8mm;left:16mm;right:16mm;border-top:1px solid #e2e8ed;padding-top:2mm;display:flex;justify-content:space-between;color:#8a969e;font-size:7.4pt}
    @media print{body{background:white}.paper{margin:0}}
  </style></head><body>${pages.map((blocks,index)=>`<article class="paper"><div class="masthead"><img src="${logo}" alt="VirTour Logo"><span>VirTour · 产品与技术</span><span>实现状态说明 · 2026.11</span></div><main>${blocks.map(block=>htmlBlock(block,images)).join('')}</main><footer><span>深圳世界之窗示范场景｜v0.1｜2026-11-18</span><span>${index+1} / 3</span></footer></article>`).join('')}</body></html>`;
  await writeFile(`${docs}/${stem}.html`,html);
  const page=await browser.newPage({viewport:{width:794,height:1123},deviceScaleFactor:1});
  await page.goto(new URL(`../docs/${stem}.html`,import.meta.url).href);
  await page.emulateMedia({media:'print'});
  await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(image=>image.decode()));});
  const layout=await page.locator('.paper').evaluateAll(elements=>elements.map((paper,index)=>{
    const main=paper.querySelector('main').getBoundingClientRect(),footer=paper.querySelector('footer').getBoundingClientRect();
    return {page:index+1,clearancePx:Math.round(footer.top-main.bottom),scrollWidth:paper.scrollWidth,clientWidth:paper.clientWidth,images:[...paper.querySelectorAll('img')].every(image=>image.complete&&image.naturalWidth>0)};
  }));
  assert.ok(layout.every(p=>p.clearancePx>=10&&p.scrollWidth<=p.clientWidth+1&&p.images),JSON.stringify(layout));
  for(let i=0;i<3;i++)await page.locator('.paper').nth(i).screenshot({path:`${root}agent-tmp/product-technology/page-${i+1}.png`});
  const pdf=await page.pdf({path:`${docs}/${stem}.pdf`,preferCSSPageSize:true,printBackground:true,tagged:true,outline:true});
  const pageCount=[...pdf.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length;
  assert.equal(pageCount,3);
  assert.ok(pdf.includes(Buffer.from('/FontFile')), 'PDF must embed fonts for Chinese text');
  await page.close();
  const docx=await makeWord(pages,images);
  await writeFile(`${docs}/${stem}.docx`,docx);
  const archive=unzipSync(docx);
  assert.ok(archive['word/document.xml']&&archive['word/styles.xml']&&archive['[Content_Types].xml']);
  const xml=new TextDecoder().decode(archive['word/document.xml']);
  assert.equal((xml.match(/w:type="page"/g)||[]).length,2);
  assert.equal(Object.keys(archive).filter(name=>name.startsWith('word/media/')).length,3);
  const report={source:'docs/PRODUCT_TECHNOLOGY.md',pdfPages:pageCount,layout,docx:{editable:true,explicitPageBreaks:2,embeddedScreenshots:3,packageChecked:true,officeRendered:false},screenshots:'agent-tmp/product-technology/',outputs:['md','docx','pdf','html']};
  await writeFile(`${root}agent-tmp/product-technology/export-check.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {await browser.close();}

function parse(markdown){
  const lines=markdown.trim().split('\n'),blocks=[];
  for(let i=0;i<lines.length;){
    const line=lines[i].trim();
    if(!line){i++;continue;}
    const image=line.match(/^!\[(.*?)\]\((.*?)\)$/);
    if(image){
      const images=[];
      while(i<lines.length){
        const match=lines[i].trim().match(/^!\[(.*?)\]\((.*?)\)$/);
        if(!match)break;
        images.push({alt:match[1],path:match[2]});i++;
      }
      blocks.push({kind:'gallery',images});continue;
    }
    if(line.startsWith('|')){
      const rows=[];
      while(i<lines.length&&lines[i].trim().startsWith('|')){
        const cells=lines[i].trim().slice(1,-1).split('|').map(cell=>cell.trim());
        if(!cells.every(cell=>/^:?-+:?$/.test(cell)))rows.push(cells);
        i++;
      }
      blocks.push({kind:'table',rows});continue;
    }
    const heading=line.match(/^(#{1,3}) (.+)$/);
    if(heading){blocks.push({kind:'heading',level:heading[1].length,text:heading[2]});i++;continue;}
    if(line.startsWith('- ')){blocks.push({kind:'list',text:line.slice(2)});i++;continue;}
    const paragraph=[line];i++;
    while(i<lines.length&&lines[i].trim()&&!/^(?:#{1,3} |!\[|\||- )/.test(lines[i].trim()))paragraph.push(lines[i++].trim());
    const text=paragraph.join(' ');
    const cls=text.startsWith('深圳世界之窗数字')?'meta':text.startsWith('*图 1')?'caption':/^\[\d+\]/.test(text)?'references':text.startsWith('**参考与证据')?'reference-title':text.startsWith('项目依据：')?'evidence':'';
    blocks.push({kind:'paragraph',text,cls});
  }
  return blocks;
}
function escape(text){return String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));}
function tokens(text){return [...text.matchAll(/\*\*(.+?)\*\*|`([^`]+)`|\*([^*]+)\*|https:\/\/[^\s]+|([^*`]+?)(?=\*\*|`|\*|https:\/\/|$)/g)].map(m=>({text:m[1]??m[2]??m[3]??m[4]??m[0],bold:Boolean(m[1]),code:Boolean(m[2]),italic:Boolean(m[3]),link:m[0].startsWith('https://')}));}
function inline(text){return tokens(text).map(t=>t.bold?`<strong>${escape(t.text)}</strong>`:t.code?`<code>${escape(t.text)}</code>`:t.italic?`<em>${escape(t.text)}</em>`:t.link?`<a href="${escape(t.text)}">${escape(t.text)}</a>`:escape(t.text)).join('');}
function htmlBlock(block,images){
  if(block.kind==='heading')return `<h${block.level}>${inline(block.text)}</h${block.level}>`;
  if(block.kind==='paragraph')return `<p class="${block.cls}">${inline(block.text)}</p>`;
  if(block.kind==='list')return `<p class="list-item">• ${inline(block.text)}</p>`;
  if(block.kind==='gallery')return `<div class="gallery">${block.images.map(image=>`<figure><img alt="${escape(image.alt)}" src="data:image/png;base64,${images.get(image.path).bytes.toString('base64')}"><figcaption>${escape(image.alt)}</figcaption></figure>`).join('')}</div>`;
  if(block.kind==='table')return `<table><thead><tr>${block.rows[0].map(cell=>`<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${block.rows.slice(1).map(row=>`<tr>${row.map(cell=>`<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  throw new Error(`Unknown block: ${block.kind}`);
}

async function makeWord(pages,images){
  const files={},rels=[],imageIds=new Map();
  let relationIndex=10,drawingId=0;
  const rel=(type,target,external=false)=>{
    const id=`rId${relationIndex++}`;
    rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${escape(target)}"${external?' TargetMode="External"':''}/>`);
    return id;
  };
  for(const [path,image] of images){
    const name=`image${imageIds.size+1}.png`;
    imageIds.set(path,rel('image',`media/${name}`));
    files[`word/media/${name}`]=image.bytes;
  }
  function runs(text,size=20){
    return tokens(text).map(token=>{
      const font=token.code?'Consolas':'Calibri';
      const run=`<w:r><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="Microsoft YaHei"/>${token.bold?'<w:b/>':''}${token.italic?'<w:i/>':''}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr><w:t xml:space="preserve">${escape(token.text)}</w:t></w:r>`;
      return token.link?`<w:hyperlink r:id="${rel('hyperlink',token.text,true)}">${run}</w:hyperlink>`:run;
    }).join('');
  }
  function para(text,{style='Normal',size=20,after=82,before=0,keep=false,align='both'}={}){
    return `<w:p><w:pPr><w:pStyle w:val="${style}"/><w:jc w:val="${align}"/><w:spacing w:before="${before}" w:after="${after}" w:line="275" w:lineRule="auto"/><w:widowControl/>${keep?'<w:keepNext/>':''}</w:pPr>${runs(text,size)}</w:p>`;
  }
  function drawing(image){
    const data=images.get(image.path),cy=2600000,cx=Math.round(cy*data.width/data.height),id=++drawingId;
    return `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="50"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Screenshot ${id}" descr="${escape(image.alt)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="Screenshot ${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${imageIds.get(image.path)}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  }
  const noBorders='<w:tblBorders>'+['top','left','bottom','right','insideH','insideV'].map(side=>`<w:${side} w:val="nil"/>`).join('')+'</w:tblBorders>';
  function gallery(block){
    return `<w:tbl><w:tblPr><w:tblW w:w="10092" w:type="dxa"/><w:tblLayout w:type="fixed"/>${noBorders}</w:tblPr><w:tblGrid>${block.images.map(()=>'<w:gridCol w:w="3364"/>').join('')}</w:tblGrid><w:tr><w:trPr><w:cantSplit/></w:trPr>${block.images.map(image=>`<w:tc><w:tcPr><w:tcW w:w="3364" w:type="dxa"/></w:tcPr>${drawing(image)}${para(image.alt,{size:15,align:'center',after:40})}</w:tc>`).join('')}</w:tr></w:tbl>${para('',{after:0,size:2})}`;
  }
  function table(block){
    const widths=[2321,3633,4138];
    const borders='<w:tblBorders>'+['top','left','bottom','right','insideH','insideV'].map(side=>`<w:${side} w:val="single" w:sz="4" w:color="D7E0E6"/>`).join('')+'</w:tblBorders>';
    return `<w:tbl><w:tblPr><w:tblW w:w="10092" w:type="dxa"/><w:tblLayout w:type="fixed"/>${borders}<w:tblCellMar><w:top w:w="65" w:type="dxa"/><w:left w:w="85" w:type="dxa"/><w:bottom w:w="65" w:type="dxa"/><w:right w:w="85" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map(width=>`<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${block.rows.map((row,index)=>`<w:tr><w:trPr><w:cantSplit/>${index===0?'<w:tblHeader/>':''}</w:trPr>${row.map((cell,col)=>`<w:tc><w:tcPr><w:tcW w:w="${widths[col]}" w:type="dxa"/>${index===0?'<w:shd w:fill="EAF1F6"/>':''}</w:tcPr>${para(index===0?`**${cell}**`:cell,{size:17,after:0,align:'left'})}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>${para('',{size:2,after:0})}`;
  }
  function blockXml(block){
    if(block.kind==='heading')return para(block.text,{style:`Heading${block.level}`,size:block.level===1?36:block.level===2?25:21,before:block.level===1?0:130,after:90,keep:true,align:'left'});
    if(block.kind==='list')return para(`• ${block.text}`);
    if(block.kind==='gallery')return gallery(block);
    if(block.kind==='table')return table(block);
    const small=['references','caption','evidence','meta'].includes(block.cls);
    return para(block.text,{size:small?15:20,after:block.cls==='references'?24:75,align:small?'left':'both'});
  }
  const namespaces='xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
  const body=pages.map((blocks,index)=>(index?'<w:p><w:r><w:br w:type="page"/></w:r></w:p>':'')+blocks.map(blockXml).join('')).join('');
  files['word/document.xml']=strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${namespaces}><w:body>${body}<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:footerReference w:type="default" r:id="rId3"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="900" w:right="907" w:bottom="850" w:left="907" w:header="350" w:footer="350"/></w:sectPr></w:body></w:document>`);
  files['word/header1.xml']=strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:hdr ${namespaces}>${para('VirTour · 产品与技术　｜　实现状态说明 · 2026.11',{size:16,after:40,align:'left'})}</w:hdr>`);
  files['word/footer1.xml']=strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:ftr ${namespaces}><w:p><w:pPr><w:jc w:val="center"/></w:pPr>${runs('深圳世界之窗示范场景｜v0.1｜2026-11-18　　',14)}<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>PAGE</w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`);
  files['word/styles.xml']=strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei"/><w:sz w:val="20"/><w:lang w:val="zh-CN" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="75" w:line="275" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${[1,2,3].map(level=>`<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="${level-1}"/></w:pPr><w:rPr><w:b/><w:color w:val="345975"/></w:rPr></w:style>`).join('')}</w:styles>`);
  files['word/settings.xml']=strToU8('<?xml version="1.0" encoding="UTF-8"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>');
  const staticRels=[['rId1','styles','styles.xml'],['rId2','header','header1.xml'],['rId3','footer','footer1.xml'],['rId4','settings','settings.xml']].map(([id,type,target])=>`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`).join('');
  files['word/_rels/document.xml.rels']=strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${staticRels}${rels.join('')}</Relationships>`);
  files['_rels/.rels']=strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>');
  files['docProps/core.xml']=strToU8('<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>VirTour 产品与技术文档</dc:title><dc:subject>深圳世界之窗数字导览与伴游系统</dc:subject><dc:description>截至2026-11-18的实际实现与验证边界</dc:description><dc:language>zh-CN</dc:language></cp:coreProperties>');
  const types=[['/word/document.xml','application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'],['/word/styles.xml','application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml'],['/word/settings.xml','application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml'],['/word/header1.xml','application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml'],['/word/footer1.xml','application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml'],['/docProps/core.xml','application/vnd.openxmlformats-package.core-properties+xml']];
  files['[Content_Types].xml']=strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>${types.map(([path,type])=>`<Override PartName="${path}" ContentType="${type}"/>`).join('')}</Types>`);
  return zipSync(files,{level:6});
}
