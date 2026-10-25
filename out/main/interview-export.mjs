import { writeFile } from "node:fs/promises";

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const dateLabel = value => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "未记录";

export function buildInterviewExportHtml(interview) {
  const transcripts = interview.transcripts ?? [];
  const answers = interview.answers ?? [];
  const title = escapeHtml(interview.title || "面试记录");
  const block = (label, content, detail = "") => `<article><h3>${escapeHtml(label)}</h3>${detail ? `<p class="meta">${escapeHtml(detail)}</p>` : ""}<div class="content">${escapeHtml(content)}</div></article>`;
  const transcriptHtml = transcripts.map(t => block(t.source === "mic" ? "我的语音转写" : "对方 / 系统音频转写", t.content,
    `${dateLabel(t.createdAt)}${t.isFinal === false ? " · 未定稿转写" : ""}`)).join("");
  const answerHtml = answers.filter(a => ["user", "assistant"].includes(a.role)).map(a => block(
    a.role === "user" ? "提问" : "AI 参考回答", a.content,
    `${dateLabel(a.createdAt)}${a.includeScreenshot ? " · 包含截图（本导出仅含文字）" : ""}${a.evidenceIds?.length ? ` · 引用：${a.evidenceIds.join("、")}` : ""}`)).join("");
  const incompleteHtml=(interview.answerAttempts??[]).filter(a=>a.status!=="completed").map(a=>block(`未完成提问：${a.question}`,a.partialText||a.error||"尚无回答",`${dateLabel(a.createdAt)} · ${a.status}`)).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src 'none'"><title>${title}</title><style>
    @page { size: A4; margin: 18mm 17mm 20mm; }
    * { box-sizing: border-box; } body { margin: 0; color: #172033; font: 11pt/1.7 "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; }
    h1 { font-size: 24pt; line-height: 1.4; margin: 0 0 10px; overflow-wrap: anywhere; }
    h2 { font-size: 16pt; margin-top: 28px; border-bottom: 2px solid #dde4ee; padding-bottom: 8px; break-after: avoid; }
    h3 { font-size: 11pt; margin: 14px 0 3px; break-after: avoid; color: #264b70; }
    .meta { font-size: 9pt; color: #607080; margin: 2px 0 9px; overflow-wrap: anywhere; }
    .content { white-space: pre-wrap; overflow-wrap: anywhere; orphans: 3; widows: 3; }
    .note { padding: 12px 16px; background: #f1f5f9; border-left: 3px solid #8aa5c2; font-size: 10pt; }
    .review { break-before: page; } .writing { height: 100px; border-bottom: 1px solid #d9e1ea; }
  </style></head><body><h1>${title}</h1>
  <p class="meta">${escapeHtml(dateLabel(interview.startAt ?? interview.createdAt))} — ${escapeHtml(dateLabel(interview.endAt))}<br>状态：${interview.status === "ended" ? "已结束" : "尚未结束 / 记录快照"} · 导出时间：${escapeHtml(dateLabel(new Date().toISOString()))}</p>
  <p class="note">语音转写可能存在识别错误。AI 参考回答不是本人当时的实际发言，也不是已核实的个人经历。本文件含本次已保存的文字记录，请按需要保管。</p>
  <h2>一、面试转写</h2>${transcriptHtml || '<p class="meta">本次没有保存的语音转写。</p>'}
  <h2>二、提问与 AI 参考回答</h2>${answerHtml || '<p class="meta">本次没有保存的 AI 回答。</p>'}${incompleteHtml}
  ${interview.reviewNotes?`<h2>我的复盘笔记</h2><div class="content">${escapeHtml(interview.reviewNotes)}</div>`:''}
  <section class="review"><h2>三、面试复盘（自行填写）</h2><p class="meta">以下是复盘提纲，未生成自动评分或评价。</p>
  ${["哪些问题答得好？", "哪些问题需要补充证据或重新练习？", "需要更新哪些项目材料或知识卡片？", "下次面试前要完成什么？"].map(q => `<h3>${q}</h3><div class="writing"></div>`).join("")}</section>
  </body></html>`;
}

export function authorizeRecordExport(event, BrowserWindow) {
  const frame = event.senderFrame;
  const main = event.sender?.mainFrame;
  if (!frame || !main || frame.processId !== main.processId || frame.routingId !== main.routingId) return false;
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window.isDestroyed()) return false;
  try {
    const url = new URL(frame.url);
    if (url.hash.startsWith("#/overlay")) return false;
    return (url.protocol === "cheater:" && url.hostname === "localhost")
      || (Boolean(process.env.ELECTRON_RENDERER_URL) && url.origin === new URL(process.env.ELECTRON_RENDERER_URL).origin);
  } catch { return false; }
}

export function registerInterviewExportIpc({ ipcMain, BrowserWindow, dialog, store }) {
  let exporting = false;
  ipcMain.handle("interview-records:export-pdf", async (event, id) => {
    if (!authorizeRecordExport(event, BrowserWindow)) throw new Error("当前页面无权导出面试记录。");
    if (typeof id !== "string" || id.length > 128) throw new TypeError("无效的面试记录编号。");
    const interview = store.state.interviews.find(item => item.id === id && !item.deletedAt);
    if (!interview) throw new Error("面试记录不存在。");
    if (exporting) throw new Error("正在导出，请稍后重试。");
    exporting = true;
    let printWindow;
    try {
      const snapshot = structuredClone(interview);
      const name = (snapshot.title || "面试记录").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 70);
      const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
        title: "导出面试记录与复盘", defaultPath: `Cheater-${name}.pdf`,
        filters: [{ name: "PDF 文档", extensions: ["pdf"] }], properties: ["showOverwriteConfirmation"],
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      printWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      printWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildInterviewExportHtml(snapshot))}`);
      const pdf = await printWindow.webContents.printToPDF({ pageSize: "A4", printBackground: true, preferCSSPageSize: true,
        displayHeaderFooter: true, headerTemplate: "<span></span>",
        footerTemplate: '<div style="font-size:8px;color:#607080;text-align:center;width:100%">Cheater · <span class="pageNumber"></span> / <span class="totalPages"></span></div>' });
      await writeFile(result.filePath, pdf);
      return { canceled: false };
    } finally {
      if (printWindow && !printWindow.isDestroyed()) printWindow.destroy();
      exporting = false;
    }
  });
}
