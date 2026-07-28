/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb', // сканы PDF во вложениях писем
    },
  },
  transpilePackages: ['antd', '@ant-design/icons', '@ant-design/cssinjs'],
};

export default nextConfig;
