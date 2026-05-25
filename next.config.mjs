/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  transpilePackages: ['antd', '@ant-design/icons', '@ant-design/cssinjs'],
};

export default nextConfig;
