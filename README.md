# Family Screen｜自己挑影片給家人看

我想把家裡已經有的影片整理好，讓小孩能隨選、續看，也讓長輩在電視或電腦上操作。這件事不需要再開一個公開影片頻道，也不需要為了少數幾位家人架一台轉檔伺服器。

Family Screen 是一套可以自己部署的家庭片庫：用接近 YouTube 的方式找影片、看章節、接著播放下一集，並記住每個帳號看到哪裡。程式碼可以開源；你的影片、封面、片單和帳密留在自己的 Cloudflare 帳戶與本機，不會放進這個 repo。

目前這版由一個 Cloudflare Worker 提供網頁與 API，D1 保存帳號、片單和觀看進度，私人 R2 bucket 保存 MP4 與封面。影片由 R2 按位元組範圍送給瀏覽器，不必另外轉成 HLS。電視能否順利播放，仍要用實際的電視或電視盒測試。

網站目前只負責找片、播放和續看，沒有網頁後台可以上傳或管理影片。新增影片由持有者在自己的電腦上用 `$family-screen-setup` skill 協助執行本 repo 的 CLI：整理片單、產生封面、上傳到私人 R2，再更新 D1。

## 用 skill 匯入影片

在持有影片的電腦 clone 這份 repo，安裝 repo 內的 skill：

```bash
mkdir -p ~/.codex/skills
cp -R skills/family-screen-setup ~/.codex/skills/
```

接著在 Codex 開啟這份 repo，指定 `$family-screen-setup`。例如：

> `$family-screen-setup` 請把 `/absolute/path/to/videos` 加進我現有的 Family Screen。保留原本的片單與 Cloudflare 設定，先列出新增影片、容量和預估費用；依我選定的項目上傳，最後驗證登入保護與播放。

第一次使用時，也可以請 skill 從部署開始處理。下面保留完整指令，方便知道 skill 實際會做什麼，或自行在終端機操作。增補既有片庫時要保留 `private/manifest.json`：`scan` 和 `from-catalog` 會依這次提供的來源重建本機片單，不能只掃新資料夾就直接覆蓋舊片單。

## 先在本機跑起來

需要 Node.js 22 以上、npm、ffmpeg 和 ffprobe。Clone repo 後：

```bash
npm install
npm run setup -- --name my-family-screen
npm run cf:types
npm run db:local
npm run build
npm run cli -- user-add --username family --local --credentials-file private/local-login.txt
npm run dev
```

用 `private/local-login.txt` 裡的帳密登入 Wrangler 印出的本機網址。這個檔案只留在本機，權限設為 `0600`；`private/` 和 `wrangler.jsonc` 都已被 Git 忽略。D1 保存的是加鹽雜湊，不是明文密碼。CLI 會產生隨機密碼，請不要改成容易猜的家庭共用密碼。

## 把自己的影片放進片單

有一般影片資料夾，就掃描 MP4：

```bash
npm run cli -- scan --dir /absolute/path/to/videos
```

若已經整理好 JSON 片單，改用：

```bash
npm run cli -- from-catalog --input /absolute/path/to/catalog.json
```

兩種方式都會建立 `private/manifest.json`。新影片預設不發布；先看過片名、來源和順序，再核准要放進家用片庫的項目：

```bash
npm run cli -- approve --ids ID1,ID2,ID3
```

只有確定整份片單都要發布時，才執行 `--all`：

```bash
npm run cli -- approve --all
```

接著估算容量，先產生三支試播影片的封面：

```bash
npm run cli -- estimate
npm run cli -- prepare --limit 3
```

`scan` 只接受含 H.264 影像的 MP4；若有音訊，需為 AAC。這樣做是為了讓一般瀏覽器與電視比較容易直接播放；其他格式要先自行轉檔。`prepare` 會從影片產生封面，`estimate` 會列出 R2 儲存量與費用假設。

## 部署到自己的 Cloudflare

先在 Cloudflare 啟用 R2，建立與 `wrangler.jsonc` 中 `bucket_name` 相同的私人 bucket，並確認沒有開啟 R2 公開網址或公開網域。Wrangler 要登入你的 Cloudflare 帳戶。接著：

```bash
npx wrangler whoami
npm run deploy
npm run db:remote
npm run cli -- user-add --username family --credentials-file private/remote-login.txt
npm run cli -- import --limit 3 --wrangler
npm run cli -- verify --url https://YOUR-WORKER.workers.dev --video-id YOUR-VIDEO-ID
```

先試播三支小於 300 MiB 的影片，可以直接沿用 Wrangler 登入。登入後檢查片單、封面、拖曳進度、下一集與續看；也用未登入的視窗確認片單和影片要求會回 `401`。`verify` 只檢查匿名存取，電視遙控器與播放能力還是要在實機上驗證。

網頁本身是公開可載入的靜態殼；片單 API、封面與影片要有有效的 D1 登入 session 才能讀取。R2 bucket 不需要公開網址。這些限制由程式與儲存設定執行；`noindex` 只是避免搜尋引擎收錄，不能代替登入保護。

## 三支試播沒問題後，匯入整批

大檔和整批上傳使用 R2 的 S3 API。到 Cloudflare 建立**只限這個 bucket、Object Read & Write、短效期**的 User API token；把它的資料存成 Git 忽略的 `private/r2-upload.json`：

```json
{
  "accountId": "YOUR_CLOUDFLARE_ACCOUNT_ID",
  "bucket": "my-family-screen-media",
  "accessKeyId": "YOUR_R2_ACCESS_KEY_ID",
  "secretAccessKey": "YOUR_R2_SECRET_ACCESS_KEY"
}
```

在 macOS／Linux 上執行 `chmod 600 private/r2-upload.json`。先前的三支試播必須已經上傳，因為檢查指令會讀取片單第一支影片來驗證金鑰：

```bash
npm run upload:all -- --check
nohup npm run upload:all > private/upload.log 2>&1 &
cat private/upload-status.json
tail -f private/upload.log
```

腳本會補齊封面、依序上傳已核准的影片，最後才把完整片單寫進 D1。中途中斷時，先看 `private/upload-status.json` 的錯誤；金鑰仍有效就重跑同一指令，已上傳且 SHA-256 相同的物件會略過。成功後腳本會刪除暫存金鑰。若金鑰過期，就建立新的限定 token 再跑。上傳期間請保持電腦喚醒、來源硬碟連線。

也可以直接設定 `R2_ACCOUNT_ID`、`R2_BUCKET`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY` 四個環境變數，手動執行 `npm run cli -- prepare` 與 `npm run cli -- import`。不要把金鑰貼進 Git、指令列參數或 issue。

## 費用與取捨

以約 92 GB 的片庫為例，若帳戶每月 10 GB 免費 R2 Standard 額度尚未被其他專案使用，儲存費約 US$1.23／月。封面、額外操作、其他專案用量與稅費另計；實際請以帳戶用量和 [Cloudflare R2 定價](https://developers.cloudflare.com/r2/pricing/)為準。這裡不做即時轉檔，主要是為了讓少量家庭播放維持簡單、便宜。[Workers](https://developers.cloudflare.com/workers/platform/pricing/) 與 [D1](https://developers.cloudflare.com/d1/platform/pricing/) 也有各自的免費額度與超額規則。

## 程式在哪裡

| 路徑 | 用途 |
|---|---|
| `src/` | 找片、播放器、續看介面 |
| `server/` | 登入、片單、進度與私人媒體路由 |
| `cli/`、`scripts/` | 片單、帳號、封面與可重跑的上傳工具 |
| `migrations/` | D1 資料表 |
| `skills/family-screen-setup/` | 給 Codex 使用的安裝與驗證 skill |
| `tests/` | 本機登入、私人播放與續看測試 |

程式碼採 MIT 授權；每個家庭自己提供的影片與帳戶資料不屬於這份開源程式碼。

## 想做管理後台？

目前影片匯入交給 skill 和本機工具處理，網頁沒有新增、修改與刪除影片的 CRUD。如果你想做管理後台，歡迎發 PR；請讓 R2 保持私人、管理操作需要登入，且不要把上傳憑證交給瀏覽器。
