// 지우개: 사진 위의 채점 표시(○, ✕, 빗금, 적어 둔 답)를 손가락이나 마우스로 문질러 지운다.
import { modal, loading } from "./ui.js";

function load(src) {
  return new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = src; });
}

// 종이 색을 사진 네 귀퉁이에서 추정 (밝은 픽셀 평균)
function paperColor(ctx, w, h) {
  const pts = [];
  for (const [x, y] of [[0, 0], [w - 24, 0], [0, h - 24], [w - 24, h - 24]]) {
    const d = ctx.getImageData(Math.max(0, x), Math.max(0, y), 24, 24).data;
    for (let i = 0; i < d.length; i += 4) pts.push([d[i], d[i + 1], d[i + 2]]);
  }
  pts.sort((a, b) => b[0] + b[1] + b[2] - (a[0] + a[1] + a[2]));
  const top = pts.slice(0, Math.max(1, Math.floor(pts.length / 2)));
  const avg = [0, 1, 2].map((k) => Math.round(top.reduce((s, p) => s + p[k], 0) / top.length));
  return `rgb(${avg.join(",")})`;
}

/** 지우개 창을 연다. 저장하면 지운 사진(dataURL), 취소하면 null */
export async function openEraser(src) {
  const img = await load(src);
  return new Promise((resolve) => {
    let done = false;
    const m = modal(`
      <h3>🧽 채점 표시 지우기</h3>
      <p class="muted center small">○·✕, 빗금, 내가 쓴 답을 손가락으로 문질러 지워요.</p>
      <div class="eraser-tools">
        <label>굵기 <input type="range" min="8" max="70" value="24" data-size></label>
        <div class="seg">
          <button class="on" data-color="paper">종이색</button><button data-color="white">흰색</button>
        </div>
        <button class="btn small" data-undo>↶ 되돌리기</button>
        <button class="btn small ghost" data-reset>처음부터</button>
      </div>
      <div class="eraser-wrap"><canvas></canvas></div>
      <div class="btn-row">
        <button class="btn primary" data-save>저장</button>
        <button class="btn ghost" data-close>취소</button>
      </div>`, (el) => {
      const canvas = el.querySelector("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      canvas.width = img.width; canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      const colors = { paper: paperColor(ctx, img.width, img.height), white: "#ffffff" };
      let color = colors.paper, history = [], drawing = false, last = null;

      const sizeInput = el.querySelector("[data-size]");
      const scale = () => canvas.width / canvas.getBoundingClientRect().width;
      const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * scale(), y: (e.clientY - r.top) * scale() }; };
      const stroke = (a, b) => {
        ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineCap = "round"; ctx.lineJoin = "round";
        ctx.lineWidth = sizeInput.value * scale();
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      };
      canvas.addEventListener("pointerdown", (e) => {
        e.preventDefault(); canvas.setPointerCapture(e.pointerId);
        history.push(ctx.getImageData(0, 0, canvas.width, canvas.height)); if (history.length > 15) history.shift();
        drawing = true; last = pos(e); stroke(last, last);
      });
      canvas.addEventListener("pointermove", (e) => { if (!drawing) return; const p = pos(e); stroke(last, p); last = p; });
      const end = () => { drawing = false; };
      canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end);

      el.querySelectorAll("[data-color]").forEach((b) => b.onclick = () => {
        color = colors[b.dataset.color];
        el.querySelectorAll("[data-color]").forEach((x) => x.classList.toggle("on", x === b));
      });
      el.querySelector("[data-undo]").onclick = () => { const h = history.pop(); if (h) ctx.putImageData(h, 0, 0); };
      el.querySelector("[data-reset]").onclick = () => { history = []; ctx.drawImage(img, 0, 0); };
      el.querySelector("[data-save]").onclick = () => {
        loading(true, "저장하는 중…");
        let q = 0.82, data = canvas.toDataURL("image/jpeg", q);
        while (data.length > 650_000 && q > 0.4) { q -= 0.1; data = canvas.toDataURL("image/jpeg", q); }
        loading(false);
        done = true; el.remove(); resolve(data);
      };
    }, "wide");
    new MutationObserver((_, obs) => { if (!document.body.contains(m)) { obs.disconnect(); if (!done) resolve(null); } })
      .observe(document.body, { childList: true });
  });
}
