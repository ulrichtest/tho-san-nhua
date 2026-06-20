# Asset notes

Map bắt buộc:

- `public/assets/maps/map-clean.webp` — map sạch, dùng làm nền gameplay.
- `public/assets/maps/map-with-trash.webp` — map có rác, chỉ dùng để cắt sprite và làm overlay trong editor.

Không dùng ảnh rác rời trong gameplay nữa. Ảnh rác hiển thị trên map được tạo tự động trong `public/assets/slices/` bằng lệnh:

```powershell
npm run tiles
```

Nếu rác chưa khớp, mở `editor.html`, khoanh lại vùng hotspot đúng hơn, export `hotspots.json`, rồi chạy lại `npm run tiles`.
