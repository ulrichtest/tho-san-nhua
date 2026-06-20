# Thợ Săn Nhựa – Rebuild Clean V3

Bản này code lại theo kiến trúc mới:

- Gameplay dùng **map sạch**: `public/assets/maps/map-clean.webp`
- Rác/mảnh ghép được **cắt trực tiếp từ map có rác**: `public/assets/maps/map-with-trash.webp`
- Khi người chơi phân loại xong, miếng rác bị ẩn nên rác **biến mất thật** khỏi bản đồ.
- Editor dùng map sạch + overlay map có rác để bạn khoanh hotspot.

## Chạy local

```powershell
npm install
npm run tiles
npm run build
npm run dev
```

Mở game:

```text
http://localhost:5173
```

Mở editor:

```text
http://localhost:5173/editor.html
```


## Hiển thị đồng nhất trên các máy

Game dùng một hệ tọa độ thiết kế cố định **1280 × 720**. Toàn bộ giao diện được scale cùng một tỉ lệ theo màn hình, vì vậy vị trí popup, HUD, nút và chữ không tự reflow theo độ phân giải, tỉ lệ 16:9/16:10, Windows Display Scale hoặc browser zoom.

- Không đặt lại `ph-stage` về `width: 100%` / `height: 100%`.
- Không dùng trực tiếp `vw`, `vh` mới cho thành phần trong game; dùng `px`, `%` theo stage hoặc `--ph-vw` / `--ph-vh`.
- Các breakpoint theo kích thước trình duyệt đã được vô hiệu hóa cho giao diện game để tránh máy khác tự đổi layout.

## Khi thay map

Copy đúng 2 file:

```text
public/assets/maps/map-clean.webp
public/assets/maps/map-with-trash.webp
```

Sau đó chạy:

```powershell
npm run tiles
npm run build
npm run dev
```

`npm run tiles` sẽ đọc `hotspots.json` và cắt từng vùng rác từ `map-with-trash.webp` ra:

```text
public/assets/slices/hotspot_001.webp
public/assets/slices/hotspot_002.webp
...
```

Game sẽ đè các slice này lên map sạch. Khi xử lý xong thì slice bị ẩn.

## Deploy Vercel

Cấu hình:

```text
Framework Preset: Other
Install Command: npm install
Build Command: npm run build
Output Directory: dist
Root Directory: ./
```

Trước khi push/deploy, nhớ chạy `npm run tiles` nếu bạn vừa thay map hoặc sửa hotspot.

## Editor

Trong editor:

- Bật/tắt overlay map có rác.
- Chỉnh opacity overlay.
- Bấm `+ Tạo hotspot`, kéo vùng quanh rác.
- Gán `trashId`, `pieceId`, `factId`.
- Bấm `Download JSON`, thay vào `public/data/hotspots.json`.
- Chạy lại `npm run tiles` để tạo slice mới.

## Lưu ý

Sổ tay đang được bỏ khỏi HUD theo yêu cầu hiện tại, có thể bổ sung sau.
