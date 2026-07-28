/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb', // сканы PDF во вложениях писем
    },
    // Тяжёлые нативные/wasm-пакеты OCR не бандлим webpack'ом — грузим как внешние в рантайме
    serverComponentsExternalPackages: ['tesseract.js', 'pdf-to-png-converter', '@napi-rs/canvas'],
    // pdfjs подгружает worker динамическим import — трейсинг Next его не видит; включаем принудительно
    // в бандл функций OCR-маршрутов, иначе на Vercel «Cannot find module pdf.worker.mjs».
    outputFileTracingIncludes: {
      '/import-log': ['./node_modules/pdfjs-dist/legacy/build/*.mjs'],
      '/api/import/cron': ['./node_modules/pdfjs-dist/legacy/build/*.mjs'],
    },
  },
  transpilePackages: ['antd', '@ant-design/icons', '@ant-design/cssinjs'],
};

export default nextConfig;
