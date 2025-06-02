// CORS 헤더 설정
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  // CORS 헤더 설정
  setCorsHeaders(res);

  // OPTIONS 요청 처리
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET 요청만 허용
  if (req.method !== 'GET') {
    return res.status(405).json({
      error: 'Method not allowed',
      message: 'Only GET requests are allowed'
    });
  }

  try {
    return res.status(200).json({
      status: 'OK',
      message: 'Smart Translator API Server is running',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      platform: 'Vercel Serverless',
      endpoints: {
        translate: '/api/translate',
        vision: '/api/vision',
        health: '/api/health'
      },
      environment: {
        node: process.version,
        openaiConfigured: !!process.env.OPENAI_API_KEY
      }
    });
  } catch (error) {
    console.error('Health check error:', error);
    
    return res.status(500).json({
      status: 'Error',
      message: 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
}
