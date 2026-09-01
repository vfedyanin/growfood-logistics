/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb', // сканы PDF во вложениях писем
    },
    // pdfmake и его pdfkit читают шрифты через fs и require по своим путям —
    // после бандлинга эти пути ломаются. Оставляем пакет внешним, чтобы в
    // serverless он подтягивался из node_modules как есть.
    serverComponentsExternalPackages: ['pdfmake'],
  },
  transpilePackages: ['antd', '@ant-design/icons', '@ant-design/cssinjs'],
};

export default nextConfig;
