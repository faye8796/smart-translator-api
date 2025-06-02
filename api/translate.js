import OpenAI from 'openai';

// OpenAI 클라이언트 초기화
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// CORS 헤더 설정
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// 한국어 감지 함수
function detectKorean(text) {
  const koreanRegex = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/;
  return koreanRegex.test(text);
}

// 번역 프롬프트 생성 함수
function createTranslationPrompt(text, isKorean) {
  if (isKorean) {
    return `다음 한국어 텍스트를 자연스러운 영어로 번역해주세요. 문맥과 뉘앙스를 고려하여 번역하세요.

텍스트: "${text}"

번역:`;
  } else {
    return `다음 영어 텍스트를 자연스러운 한국어로 번역해주세요. 문맥과 뉘앙스를 고려하여 번역하세요.

텍스트: "${text}"

번역:`;
  }
}

export default async function handler(req, res) {
  // CORS 헤더 설정
  setCorsHeaders(res);

  // OPTIONS 요청 처리 (CORS preflight)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET 요청 - 헬스 체크
  if (req.method === 'GET') {
    try {
      // 간단한 번역 테스트
      const testCompletion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Say "OK" in Korean' }],
        max_tokens: 10
      });

      return res.status(200).json({
        status: 'OK',
        message: 'Translation service is working',
        testResponse: testCompletion.choices[0].message.content.trim(),
        model: 'gpt-4o'
      });
    } catch (error) {
      return res.status(503).json({
        status: 'Error',
        message: 'Translation service is not available',
        error: error.message
      });
    }
  }

  // POST 요청만 허용
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed',
      message: 'Only POST requests are allowed'
    });
  }

  try {
    const { text } = req.body;

    // 입력 검증
    if (!text || typeof text !== 'string') {
      return res.status(400).json({
        error: 'Invalid input',
        message: 'Text is required and must be a string'
      });
    }

    // 텍스트 길이 제한
    if (text.length > 1000) {
      return res.status(400).json({
        error: 'Text too long',
        message: 'Text must be less than 1000 characters'
      });
    }

    // 언어 감지
    const isKorean = detectKorean(text.trim());
    const targetLanguage = isKorean ? 'English' : '한국어';
    const sourceLanguage = isKorean ? '한국어' : 'English';

    console.log(`Translation request: ${sourceLanguage} -> ${targetLanguage}`);
    console.log(`Input text: ${text.substring(0, 50)}...`);

    // OpenAI API 호출
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: '당신은 전문 번역가입니다. 한국어와 영어 사이의 정확하고 자연스러운 번역을 제공합니다. 문맥과 뉘앙스를 고려하여 번역하세요.'
        },
        {
          role: 'user',
          content: createTranslationPrompt(text, isKorean)
        }
      ],
      max_tokens: 1000,
      temperature: 0.3
    });

    const translatedText = completion.choices[0].message.content.trim();

    // 성공 응답
    return res.status(200).json({
      success: true,
      data: {
        originalText: text,
        translatedText: translatedText,
        sourceLanguage: sourceLanguage,
        targetLanguage: targetLanguage,
        detectedKorean: isKorean
      },
      meta: {
        timestamp: new Date().toISOString(),
        model: 'gpt-4o',
        tokensUsed: completion.usage.total_tokens
      }
    });

  } catch (error) {
    console.error('Translation error:', error);

    // OpenAI API 에러 처리
    if (error.code === 'insufficient_quota') {
      return res.status(402).json({
        error: 'API Quota Exceeded',
        message: 'OpenAI API quota has been exceeded'
      });
    }

    if (error.code === 'invalid_api_key') {
      return res.status(401).json({
        error: 'Invalid API Key',
        message: 'OpenAI API key is invalid'
      });
    }

    if (error.code === 'rate_limit_exceeded') {
      return res.status(429).json({
        error: 'Rate Limit Exceeded',
        message: 'Too many requests to OpenAI API'
      });
    }

    // 일반적인 서버 에러
    return res.status(500).json({
      error: 'Translation Failed',
      message: 'An error occurred during translation'
    });
  }
}
