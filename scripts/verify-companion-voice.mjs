// Run the real Web Audio/WebSocket path against the isolated provider fixture.
// No paid model request and no real visitor microphone/location are used.
process.env.VIRTOUR_CALL_CASES='companion';
await import('./verify-calls.mjs');
