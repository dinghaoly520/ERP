'use client';

import React, { useEffect, useRef } from 'react';

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Header Fluid Canvas — GPU 流体模拟，仅作用于顶部栏。
   鼠标移动产生彩色涟漪拖尾，点击产生喷射。
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

interface ColorRGB { r: number; g: number; b: number }

interface Pointer {
  texcoordX: number; texcoordY: number;
  prevTexcoordX: number; prevTexcoordY: number;
  deltaX: number; deltaY: number;
  down: boolean; moved: boolean;
  color: ColorRGB;
}

export default function FluidHeader() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pointer: Pointer = {
      texcoordX: 0, texcoordY: 0,
      prevTexcoordX: 0, prevTexcoordY: 0,
      deltaX: 0, deltaY: 0,
      down: false, moved: false,
      color: { r: 0, g: 0, b: 0 },
    };

    // ── Color palette — 蓝青橙柔和系
    const palette: ColorRGB[] = [
      { r: 0.08, g: 0.12, b: 0.32 },   // 深蓝
      { r: 0.06, g: 0.18, b: 0.24 },   // 青蓝
      { r: 0.20, g: 0.12, b: 0.05 },   // 暖橙
      { r: 0.12, g: 0.08, b: 0.22 },   // 紫蓝
      { r: 0.04, g: 0.16, b: 0.18 },   // 水绿
    ];
    let colorIdx = 0;
    const pickColor = (): ColorRGB => {
      colorIdx = (colorIdx + 1) % palette.length;
      return { ...palette[colorIdx] };
    };

    // ── WebGL Setup ──
    const params = { alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false };
    const glContext = (canvas.getContext('webgl2', params) || canvas.getContext('webgl', params)) as WebGLRenderingContext | null;
    if (!glContext) return;
    const gl = glContext!;

    const isWebGL2 = typeof (gl as any).drawBuffers !== 'undefined';
    const halfFloatTexType = isWebGL2
      ? (gl as any).HALF_FLOAT
      : ((gl.getExtension('OES_texture_half_float') as any)?.HALF_FLOAT_OES) || 0;

    gl.clearColor(0, 0, 0, 1);
    gl.disable(gl.BLEND);

    // ── Shaders ──
    const compileShader = (type: number, src: string): WebGLShader | null => {
      const s = gl.createShader(type); if (!s) return null;
      gl.shaderSource(s, src); gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
    };

    const baseVS = `precision highp float;attribute vec2 aPosition;varying vec2 vUv;uniform vec2 texelSize;void main(){vUv=aPosition*0.5+0.5;gl_Position=vec4(aPosition,0.,1.);}`;

    const splatFS = `precision highp float;precision highp sampler2D;varying vec2 vUv;uniform sampler2D uTarget;uniform float aspectRatio;uniform vec3 color;uniform vec2 point;uniform float radius;void main(){vec2 p=vUv-point.xy;p.x*=aspectRatio;vec3 splat=exp(-dot(p,p)/radius)*color;vec3 base=texture2D(uTarget,vUv).xyz;gl_FragColor=vec4(base+splat,1.);}`;

    const advectionFS = `precision highp float;precision highp sampler2D;varying vec2 vUv;uniform sampler2D uVelocity;uniform sampler2D uSource;uniform vec2 texelSize;uniform float dt;uniform float dissipation;void main(){vec2 coord=vUv-dt*texture2D(uVelocity,vUv).xy*texelSize;vec4 result=texture2D(uSource,coord);float decay=1.+dissipation*dt;gl_FragColor=result/decay;}`;

    const divergenceFS = `precision mediump float;precision mediump sampler2D;varying vec2 vUv;varying vec2 vL;varying vec2 vR;varying vec2 vT;varying vec2 vB;uniform sampler2D uVelocity;void main(){float L=texture2D(uVelocity,vL).x,R=texture2D(uVelocity,vR).x,T=texture2D(uVelocity,vT).y,B=texture2D(uVelocity,vB).y;vec2 C=texture2D(uVelocity,vUv).xy;if(vL.x<0.)L=-C.x;if(vR.x>1.)R=-C.x;if(vT.y>1.)T=-C.y;if(vB.y<0.)B=-C.y;gl_FragColor=vec4(.5*(R-L+T-B),0.,0.,1.);}`;

    const curlFS = `precision mediump float;precision mediump sampler2D;varying vec2 vUv;varying vec2 vL;varying vec2 vR;varying vec2 vT;varying vec2 vB;uniform sampler2D uVelocity;void main(){float L=texture2D(uVelocity,vL).y,R=texture2D(uVelocity,vR).y,T=texture2D(uVelocity,vT).x,B=texture2D(uVelocity,vB).x;gl_FragColor=vec4(.5*(R-L-T+B),0.,0.,1.);}`;

    const vorticityFS = `precision highp float;precision highp sampler2D;varying vec2 vUv;varying vec2 vL;varying vec2 vR;varying vec2 vT;varying vec2 vB;uniform sampler2D uVelocity;uniform sampler2D uCurl;uniform float curl;uniform float dt;void main(){float L=texture2D(uCurl,vL).x,R=texture2D(uCurl,vR).x,T=texture2D(uCurl,vT).x,B=texture2D(uCurl,vB).x,C=texture2D(uCurl,vUv).x;vec2 force=.5*vec2(abs(T)-abs(B),abs(R)-abs(L));force/=length(force)+.0001;force*=curl*C;force.y*=-1.;vec2 velocity=texture2D(uVelocity,vUv).xy+force*dt;gl_FragColor=vec4(clamp(velocity,-1000.,1000.),0.,1.);}`;

    const pressureFS = `precision mediump float;precision mediump sampler2D;varying vec2 vUv;varying vec2 vL;varying vec2 vR;varying vec2 vT;varying vec2 vB;uniform sampler2D uPressure;uniform sampler2D uDivergence;void main(){float L=texture2D(uPressure,vL).x,R=texture2D(uPressure,vR).x,T=texture2D(uPressure,vT).x,B=texture2D(uPressure,vB).x;float div=texture2D(uDivergence,vUv).x;gl_FragColor=vec4((L+R+B+T-div)*.25,0.,0.,1.);}`;

    const gradSubFS = `precision mediump float;precision mediump sampler2D;varying vec2 vUv;varying vec2 vL;varying vec2 vR;varying vec2 vT;varying vec2 vB;uniform sampler2D uPressure;uniform sampler2D uVelocity;void main(){float L=texture2D(uPressure,vL).x,R=texture2D(uPressure,vR).x,T=texture2D(uPressure,vT).x,B=texture2D(uPressure,vB).x;vec2 vel=texture2D(uVelocity,vUv).xy-vec2(R-L,T-B);gl_FragColor=vec4(vel,0.,1.);}`;

    const displayFS = `precision highp float;precision highp sampler2D;varying vec2 vUv;uniform sampler2D uTexture;void main(){vec3 c=texture2D(uTexture,vUv).rgb;float a=max(c.r,max(c.g,c.b));gl_FragColor=vec4(a>0.?c/a:vec3(0.), a);}`;

    const copyFS = `precision mediump float;precision mediump sampler2D;varying vec2 vUv;uniform sampler2D uTexture;void main(){gl_FragColor=texture2D(uTexture,vUv);}`;

    const clearFS = `precision mediump float;precision mediump sampler2D;varying vec2 vUv;uniform sampler2D uTexture;uniform float value;void main(){gl_FragColor=value*texture2D(uTexture,vUv);}`;

    const makeProg = (vsSrc: string, fsSrc: string) => {
      const vs = compileShader(gl.VERTEX_SHADER, vsSrc);
      const fs = compileShader(gl.FRAGMENT_SHADER, fsSrc);
      if (!vs || !fs) return null;
      const p = gl.createProgram(); if (!p) return null;
      gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
      return p;
    };

    const getU = (p: WebGLProgram): Record<string, WebGLUniformLocation | null> => {
      const unis: Record<string, any> = {};
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) {
        const info = gl.getActiveUniform(p, i);
        if (info) unis[info.name] = gl.getUniformLocation(p, info.name);
      }
      return unis;
    };

    const prog = {
      splat:    { p: makeProg(baseVS, splatFS),     u: {} as any },
      advection:{ p: makeProg(baseVS, advectionFS), u: {} as any },
      divergence:{p: makeProg(baseVS, divergenceFS),u: {} as any },
      curl:     { p: makeProg(baseVS, curlFS),      u: {} as any },
      vorticity:{ p: makeProg(baseVS, vorticityFS), u: {} as any },
      pressure: { p: makeProg(baseVS, pressureFS),  u: {} as any },
      gradSub:  { p: makeProg(baseVS, gradSubFS),   u: {} as any },
      display:  { p: makeProg(baseVS, displayFS),   u: {} as any },
      clear:    { p: makeProg(baseVS, clearFS),     u: {} as any },
      copy:     { p: makeProg(baseVS, copyFS),      u: {} as any },
    };
    for (const k of Object.keys(prog)) {
      const pg = prog[k as keyof typeof prog];
      if (pg.p) pg.u = getU(pg.p);
    }

    // ── Blit geometry ──
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    const ebuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);

    function blit(target: any) {
      if (target) { gl.viewport(0, 0, target.w, target.h); gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo); }
      else { gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight); gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }

    // ── FBO helpers ──
    const rgba = { internalFormat: isWebGL2 ? (gl as any).RGBA16F : gl.RGBA, format: gl.RGBA };
    const rg   = { internalFormat: isWebGL2 ? (gl as any).RG16F  : gl.RGBA, format: isWebGL2 ? (gl as any).RG : gl.RGBA };
    const r    = { internalFormat: isWebGL2 ? (gl as any).R16F   : gl.RGBA, format: isWebGL2 ? (gl as any).RED : gl.RGBA };

    function makeFBO(w: number, h: number, fmt: any): any {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internalFormat, w, h, 0, fmt.format, halfFloatTexType, null);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.viewport(0, 0, w, h); gl.clear(gl.COLOR_BUFFER_BIT);
      return { tex, fbo, w, h, texelSizeX: 1/w, texelSizeY: 1/h, attach: (id: number) => { gl.activeTexture(gl.TEXTURE0+id); gl.bindTexture(gl.TEXTURE_2D, tex); return id; }};
    }

    function makeDblFBO(w: number, h: number, fmt: any) {
      return { read: makeFBO(w, h, fmt), write: makeFBO(w, h, fmt), w, h, tx: 1/w, ty: 1/h, swap() { const t = this.read; this.read = this.write; this.write = t; }};
    }

    let dye: any, velocity: any, divergence: any, curlFBO: any, pressure: any;
    const CUR = 3, PRESSURE = 0.1, PRESSURE_IT = 20, VELOCITY_DISS = 1.5, DENSITY_DISS = 3.5, SPLAT_R = 0.25, SPLAT_F = 3000;

    function resizeFB() {
      const dpr = window.devicePixelRatio || 1;
      const cw = Math.floor(canvas!.clientWidth * dpr);
      const ch = Math.floor(canvas!.clientHeight * dpr);
      canvas!.width = cw; canvas!.height = ch;

      const simW = 128, simH = Math.max(1, Math.round(128 * ch / cw));
      const dyeW = 800, dyeH = Math.max(1, Math.round(800 * ch / cw));
      dye = makeDblFBO(dyeW, dyeH, rgba);
      velocity = makeDblFBO(simW, simH, rg);
      divergence = makeFBO(simW, simH, r);
      curlFBO = makeFBO(simW, simH, r);
      pressure = makeDblFBO(simW, simH, r);
    }

    resizeFB();

    // ── Simulation step ──
    function step(dt: number) {
      gl.disable(gl.BLEND);
      const setTex = (u: any) => { if (u.texelSize) gl.uniform2f(u.texelSize, velocity.tx, velocity.ty); };

      // curl
      gl.useProgram(prog.curl.p); setTex(prog.curl.u);
      gl.uniform1i(prog.curl.u.uVelocity, velocity.read.attach(0));
      blit(curlFBO);

      // vorticity
      gl.useProgram(prog.vorticity.p); setTex(prog.vorticity.u);
      gl.uniform1i(prog.vorticity.u.uVelocity, velocity.read.attach(0));
      gl.uniform1i(prog.vorticity.u.uCurl, curlFBO.attach(1));
      gl.uniform1f(prog.vorticity.u.curl, CUR);
      gl.uniform1f(prog.vorticity.u.dt, dt);
      blit(velocity.write); velocity.swap();

      // divergence
      gl.useProgram(prog.divergence.p); setTex(prog.divergence.u);
      gl.uniform1i(prog.divergence.u.uVelocity, velocity.read.attach(0));
      blit(divergence);

      // pressure clear
      gl.useProgram(prog.clear.p);
      gl.uniform1i(prog.clear.u.uTexture, pressure.read.attach(0));
      gl.uniform1f(prog.clear.u.value, PRESSURE);
      blit(pressure.write); pressure.swap();

      // pressure iterations
      for (let i = 0; i < PRESSURE_IT; i++) {
        gl.useProgram(prog.pressure.p); setTex(prog.pressure.u);
        gl.uniform1i(prog.pressure.u.uDivergence, divergence.attach(0));
        gl.uniform1i(prog.pressure.u.uPressure, pressure.read.attach(1));
        blit(pressure.write); pressure.swap();
      }

      // gradient subtract
      gl.useProgram(prog.gradSub.p); setTex(prog.gradSub.u);
      gl.uniform1i(prog.gradSub.u.uPressure, pressure.read.attach(0));
      gl.uniform1i(prog.gradSub.u.uVelocity, velocity.read.attach(1));
      blit(velocity.write); velocity.swap();

      // advect velocity
      gl.useProgram(prog.advection.p); setTex(prog.advection.u);
      gl.uniform1i(prog.advection.u.uVelocity, velocity.read.attach(0));
      gl.uniform1i(prog.advection.u.uSource, velocity.read.attach(0));
      gl.uniform1f(prog.advection.u.dt, dt);
      gl.uniform1f(prog.advection.u.dissipation, VELOCITY_DISS);
      blit(velocity.write); velocity.swap();

      // advect dye
      gl.useProgram(prog.advection.p); setTex(prog.advection.u);
      gl.uniform1i(prog.advection.u.uVelocity, velocity.read.attach(0));
      gl.uniform1i(prog.advection.u.uSource, dye.read.attach(1));
      gl.uniform1f(prog.advection.u.dt, dt);
      gl.uniform1f(prog.advection.u.dissipation, DENSITY_DISS);
      blit(dye.write); dye.swap();
    }

    function render() {
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.BLEND);
      gl.useProgram(prog.display.p);
      gl.uniform1i(prog.display.u.uTexture, dye.read.attach(0));
      blit(null);
    }

    function splat(x: number, y: number, dx: number, dy: number, color: ColorRGB) {
      const p = prog.splat;
      gl.useProgram(p.p);
      gl.uniform1i(p.u.uTarget, velocity.read.attach(0));
      gl.uniform1f(p.u.aspectRatio, canvas!.width / canvas!.height);
      gl.uniform2f(p.u.point, x, y);
      gl.uniform3f(p.u.color, dx, dy, 0);
      gl.uniform1f(p.u.radius, SPLAT_R / 100);
      blit(velocity.write); velocity.swap();

      gl.uniform1i(p.u.uTarget, dye.read.attach(0));
      gl.uniform3f(p.u.color, color.r, color.g, color.b);
      blit(dye.write); dye.swap();
    }

    // ── Mouse event handlers (bind to header element) ──
    const header = canvas!.closest('header');
    let lastTime = Date.now();
    let animId = 0;

    function getCanvasPos(e: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      return { x: (e.clientX - rect.left) / rect.width, y: 1 - (e.clientY - rect.top) / rect.height };
    }

    function onMouseDown(e: MouseEvent) {
      pointer.down = true;
      const pos = getCanvasPos(e);
      pointer.texcoordX = pos.x; pointer.texcoordY = pos.y;
      pointer.prevTexcoordX = pos.x; pointer.prevTexcoordY = pos.y;
      pointer.deltaX = 0; pointer.deltaY = 0;
      const c = pickColor();
      splat(pos.x, pos.y, 15 * (Math.random() - .5), 15 * (Math.random() - .5), { r: c.r * 3, g: c.g * 3, b: c.b * 3 });
    }

    function onMouseMove(e: MouseEvent) {
      const pos = getCanvasPos(e);
      pointer.prevTexcoordX = pointer.texcoordX; pointer.prevTexcoordY = pointer.texcoordY;
      pointer.texcoordX = pos.x; pointer.texcoordY = pos.y;
      const ar = canvas!.width / canvas!.height;
      let dx = pointer.texcoordX - pointer.prevTexcoordX;
      let dy = pointer.texcoordY - pointer.prevTexcoordY;
      if (ar < 1) dx *= ar; if (ar > 1) dy /= ar;
      pointer.deltaX = dx; pointer.deltaY = dy;
      pointer.moved = Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6;
    }

    function onMouseUp() {
      pointer.down = false;
    }

    if (header) {
      header.addEventListener('mousedown', onMouseDown);
      header.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    }

    // ── Animation loop ──
    function frame() {
      const now = Date.now();
      let dt = Math.min((now - lastTime) / 1000, 0.016);
      lastTime = now;

      const dpr = window.devicePixelRatio || 1;
      const cw = Math.floor(canvas!.clientWidth * dpr);
      const ch = Math.floor(canvas!.clientHeight * dpr);
      if (canvas!.width !== cw || canvas!.height !== ch) resizeFB();

      // mouse trail on any movement
      if (pointer.moved) {
        pointer.moved = false;
        const c = pickColor();
        splat(pointer.texcoordX, pointer.texcoordY,
          pointer.deltaX * SPLAT_F,
          pointer.deltaY * SPLAT_F,
          c);
      }

      step(dt); render();
      animId = requestAnimationFrame(frame);
    }

    // Kick off
    frame();

    return () => {
      cancelAnimationFrame(animId);
      if (header) {
        header.removeEventListener('mousedown', onMouseDown);
        header.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      }
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-0 block h-full w-full"
      aria-hidden="true"
    />
  );
}
