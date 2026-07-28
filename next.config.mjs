/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb', // сканы PDF во вложениях писем
    },
    // Тяжёлые нативные/wasm-пакеты OCR не бандлим webpack'ом — грузим как внешние в рантайме
    serverComponentsExternalPackages: ['tesseract.js', 'pdf-to-png-converter', '@napi-rs/canvas'],
  },
  transpilePackages: ['antd', '@ant-design/icons', '@ant-design/cssinjs'],
};

export default nextConfig;
