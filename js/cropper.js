// 자르기: 사진에서 틀린 문제 하나만 남기도록 영역을 고른다.
// 모서리를 끌어 크기 조절, 상자 안을 끌어 이동, 빈 곳을 끌면 새로 그리기, ↻ 회전
import { modal } from "./ui.js";

const toCanvas = (src, maxDim = 2400) => {
  const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
  const s = Math.min(1, maxDim / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
};
function rotate(c) {
  const r = document.createElement("canvas");
  r.width = c.height; r.height = c.width;
  const ctx = r.getContext("2d");
  ctx.translate(r.width, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(c, 0, 0);
  return r;
}

/** 자른 사진(canvas)을 돌려준다. 취소하면 null */
export function openCropper(source) {
  return new Promise((resolve) => {
    let result = null;
    let src = toCanvas(source);
    const m = modal(`
      <h3>✂️ 문제 하나만 남기기</h3>
      <p class="muted center small">모서리를 끌어 틀린 문제만 상자 안에 넣어 주세요. 주변 문제는 잘라 내요.</p>
      <div class="crop-stage"><div class="crop-wrap"><img alt="" draggable="false"><div class="crop-box"><i data-h="nw"></i><i data-h="ne"></i><i data-h="sw"></i><i data-h="se"></i></div></div></div>
      <div class="btn-row crop-tools">
        <button class="btn small" data-rotate>↻ 회전</button>
        <button class="btn small" data-all>전체 선택</button>
      </div>
      <div class="btn-row">
        <button class="btn primary" data-ok>✂️ 자르기 완료</button>
        <button class="btn ghost" data-close>취소</button>
      </div>`, (el) => {
      const wrap = el.querySelector(".crop-wrap"), img = wrap.querySelector("img"), box = wrap.querySelector(".crop-box");
      // 상자 위치는 사진 크기에 대한 비율(0~1)로 기억
      let r = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };
      const MIN = 0.06;
      const draw = () => Object.assign(box.style, { left: r.x * 100 + "%", top: r.y * 100 + "%", width: r.w * 100 + "%", height: r.h * 100 + "%" });
      const load = () => { img.src = src.toDataURL("image/jpeg", 0.85); r = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 }; draw(); };
      load();

      const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
      const pt = (e) => { const b = wrap.getBoundingClientRect(); return { x: clamp((e.clientX - b.left) / b.width, 0, 1), y: clamp((e.clientY - b.top) / b.height, 0, 1) }; };
      let drag = null;
      wrap.addEventListener("pointerdown", (e) => {
        e.preventDefault(); wrap.setPointerCapture(e.pointerId);
        const p = pt(e), h = e.target.dataset?.h;
        if (h) drag = { mode: h, start: p, r: { ...r } };
        else if (e.target === box) drag = { mode: "move", start: p, r: { ...r } };
        else { drag = { mode: "new", start: p, r: { ...r } }; r = { x: p.x, y: p.y, w: 0, h: 0 }; draw(); }
      });
      wrap.addEventListener("pointermove", (e) => {
        if (!drag) return;
        const p = pt(e), o = drag.r, dx = p.x - drag.start.x, dy = p.y - drag.start.y;
        if (drag.mode === "move") r = { ...o, x: clamp(o.x + dx, 0, 1 - o.w), y: clamp(o.y + dy, 0, 1 - o.h) };
        else if (drag.mode === "new") r = { x: Math.min(p.x, drag.start.x), y: Math.min(p.y, drag.start.y), w: Math.abs(dx), h: Math.abs(dy) };
        else {
          let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
          // 손가락이 움직인 만큼만 모서리를 옮긴다 (잡은 위치로 튀지 않게)
          if (drag.mode.includes("w")) x0 = clamp(o.x + dx, 0, x1 - MIN);
          if (drag.mode.includes("e")) x1 = clamp(o.x + o.w + dx, x0 + MIN, 1);
          if (drag.mode.includes("n")) y0 = clamp(o.y + dy, 0, y1 - MIN);
          if (drag.mode.includes("s")) y1 = clamp(o.y + o.h + dy, y0 + MIN, 1);
          r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
        }
        draw();
      });
      const end = () => {
        if (drag?.mode === "new" && (r.w < MIN || r.h < MIN)) r = drag.r; // 살짝 누른 것은 무시
        drag = null; draw();
      };
      wrap.addEventListener("pointerup", end); wrap.addEventListener("pointercancel", end);

      el.querySelector("[data-rotate]").onclick = () => { src = rotate(src); load(); };
      el.querySelector("[data-all]").onclick = () => { r = { x: 0, y: 0, w: 1, h: 1 }; draw(); };
      el.querySelector("[data-ok]").onclick = () => {
        const sx = Math.round(r.x * src.width), sy = Math.round(r.y * src.height);
        const sw = Math.max(1, Math.round(r.w * src.width)), sh = Math.max(1, Math.round(r.h * src.height));
        const c = document.createElement("canvas");
        c.width = sw; c.height = sh;
        c.getContext("2d").drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
        result = c; el.remove();
      };
    }, "wide");
    new MutationObserver((_, obs) => { if (!document.body.contains(m)) { obs.disconnect(); resolve(result); } })
      .observe(document.body, { childList: true });
  });
}
