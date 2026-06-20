# Bản sửa lỗi chạy local

Bản này đặt `server.js` và `build.js` ngay thư mục gốc, không còn phụ thuộc vào đường dẫn `scripts/dev-server.js` để chạy game.

## Chạy nhanh trên Windows

Nhấp đúp `START_GAME.bat`, hoặc mở PowerShell tại thư mục này và chạy:

```powershell
npm install
npm run dev
```

Mở:

- Game: http://localhost:5173
- Editor: http://localhost:5173/editor.html

## Build để deploy

Nhấp đúp `BUILD_PROJECT.bat`, hoặc chạy:

```powershell
npm run build
```

Kết quả nằm trong thư mục `dist`.
