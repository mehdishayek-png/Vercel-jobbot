/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow longer serverless function execution for job matching
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

module.exports = nextConfig;
