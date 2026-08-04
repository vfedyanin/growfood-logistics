/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb', // сканы PDF во вложениях писем
    },
    // mammoth (парсинг .docx) — серверная node-библиотека, не бандлить webpack'ом.
    serverComponentsExternalPackages: ['mammoth'],
  },
  transpilePackages: ['antd', '@ant-design/icons', '@ant-design/cssinjs'],
};

export default nextConfig;
