# Refactor Log — 安全式重構（本輪）

## Phase 0：安全基線

- 起始 `main` HEAD commit SHA：`6555204e8dcfdae939d3b63accaa34e2660d3e0b`
  （"Expand 個人紀錄 in place in the seat-score modal instead of swapping
  modals (#109)"）
- 開發分支：`claude/sharp-heisenberg-qfzplx`
- 本輪所有修改都在此分支進行，**沒有**直接改 `main`，**沒有**碰 production
  D1 資料或 R2 bucket，**沒有**執行任何 deploy。

## Rollback

若部署後任一 P0 smoke test 失敗，rollback 到：

```
6555204e8dcfdae939d3b63accaa34e2660d3e0b
```

（即本輪重構前的 `main` HEAD）。因為本輪：
- 沒有 destructive schema 變更
- 沒有 rename 任何 API path 或 DB column
- 沒有刪除任何既有功能

理論上 rollback 只是「回到重構前的程式碼」，不涉及資料復原。

## 本輪修改分類（按 commit 拆分，方便單獨 revert）

見 `git log` 上 `claude/sharp-heisenberg-qfzplx` 分支相對於上述 SHA 的
commit 列表，commit 訊息前綴：

- `docs:` — 純文件新增，零風險，可隨時 revert 不影響任何行為
- `refactor:` — 從 `worker/index.js` 抽出不碰 DB 的 pure helper 到
  `worker/lib/`，行為應完全不變（見該 commit 說明與驗證方式）
- `test:` — smoke test checklist 文件

## 驗證方式（本輪，沙盒環境限制說明）

本次工作在沒有 production Cloudflare 帳號存取權限、沒有 `wrangler`/
`node_modules` 已安裝的沙盒環境中進行，因此：

- **有做**：`node --check` 語法驗證 `worker/index.js`（含抽出 helper 後）
  確認沒有語法錯誤
- **有做**：靜態比對抽出前後的程式碼，確認抽出的函式是 pure function
  （不讀寫 `env`、不碰 D1/R2），純屬搬移，行為應與抽出前完全一致
- **沒有做**（環境限制，需要有 production 存取權的人補做）：
  - 真正跑 `wrangler dev` / 部署到 staging 驗證
  - 對照 `docs/smoke-test.md` 的 P0/P1/P2 清單在瀏覽器實測

**因此：這個分支目前只適合被 review，不建議在沒有人用瀏覽器實測過
`docs/smoke-test.md` 的 P0 清單之前就 merge 到 `main` 並部署。**
