# Production Smoke Test Checklist

> 目的：讓每次修改後知道到底有沒有壞。**部署前跑一次，部署後再跑一次。**
> 任一 P0 項目失敗 → 立即 rollback（見下方「Rollback」）。

## 怎麼跑

大部分項目需要在瀏覽器實際操作 `class-assistant.html` /
`public/open/study-habits.html` / `public/index.html`，因為前端有大量
UI 互動邏輯（modal、拖曳、canvas 拍照）不適合純 API 層測試完整取代。

有標記 **[可用 curl]** 的項目，可以先用下面這種方式快速檢查 API 本身
沒有 500（把 `<HOST>` 換成 production 網址）：

```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://<HOST>/api/schedule"
curl -s -o /dev/null -w "%{http_code}\n" "https://<HOST>/api/roster?classId=5-1"
```

200 不代表功能完全正確，只代表「沒有直接爆炸」；仍需搭配瀏覽器實測。

---

## P0（一定不能壞，明天教學會直接用到）

- [ ] 首頁可以開（`/`、`/index.html`）
- [ ] `class-assistant.html` 可以開，沒有 JS console error
- [ ] 班級列表讀得到、能自動判定目前課堂 **[可用 curl: /api/schedule]**
- [ ] 切換班級正常
- [ ] 學生名單讀得到 **[可用 curl: /api/roster?classId=]**
- [ ] 座位表顯示正常
- [ ] 座位表可以指定/清空座位
- [ ] 點學生開啟 modal 正常（座位分數 modal）
- [ ] 學生照片可以顯示
- [ ] 學生照片可以拍照/上傳
- [ ] +1 加分正常
- [ ] -1 扣分正常
- [ ] undo 復原正常（復原後畫面分數要跟著改回來）
- [ ] 遲到登記正常
- [ ] 缺席登記正常
- [ ] 遲到/缺席清除正常
- [ ] 個人紀錄可以讀取（座位分數 modal 內展開）
- [ ] 個人紀錄可以新增
- [ ] 個人紀錄可以刪除

## P1（最好正常，不影響當天教學但很快會用到）

- [ ] 作業清單讀得到
- [ ] 新增作業（會同步到所有班級）
- [ ] 作業改名（會同步到所有班級）
- [ ] 作業刪除（會同步到所有班級，含刪除已評分紀錄）
- [ ] 作品照片拍照/上傳正常
- [ ] 作品評分（分數/等第/備註）正常
- [ ] 作品照片批次下載正常
- [ ] 班級進度可以讀取
- [ ] 班級進度可以寫入
- [ ] 課表顯示正常
- [ ] 統計表（班級總覽）可以載入與排序
- [ ] 統計表 CSV 匯出正常

## P2（暫時不正常也可接受，但仍應檢查）

- [ ] 家庭習慣頁（`public/open/study-habits.html`）可以開
- [ ] 讀書習慣打卡正常
- [ ] 吃飯時間紀錄正常
- [ ] 週罰點顯示正常
- [ ] 銀行點數/提領正常
- [ ] 健康習慣頁（`index.html`）打卡正常
- [ ] activity-radar 頁面可以開，公告來源列表正常
- [ ] go-tournaments 頁面可以開

---

## 危險操作（不要在 smoke test 中誤觸）

- `POST /api/admin/reset-test-data` 會清空作品/頭像/加減分/出席資料。
  **不要**在 production 上為了測試而呼叫這支 API。

---

## Rollback

若任一 P0 項目失敗：

1. 立即停止在 production 上連續嘗試修復。
2. 記錄失敗的具體項目與錯誤訊息（console log / network response）。
3. Rollback 到本次重構的起始 commit（見下方或 `git log` 找對應的
   `docs: record refactor safety baseline` commit訊息裡記載的 SHA）。
4. Rollback 後重新跑一次本檔案的 P0 清單，確認恢復正常。
5. 回到 branch 上修好問題，重新走一次「branch 完成 → diff review →
   smoke test 通過 → merge → 部署 → 部署後再 smoke test」流程。

起始 commit（本次重構前的 `main` HEAD）：見 `docs/refactor-log.md`。
