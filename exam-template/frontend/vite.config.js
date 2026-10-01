export default {
  server: {
    host: '0.0.0.0',
    port: 4200,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8081' },
  },
};
