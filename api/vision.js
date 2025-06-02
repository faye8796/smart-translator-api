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

// 멀티파트 파싱 함수 (간단한 구현)
function parseMultipart(buffer, boundary) {
  const parts = [];
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  
  let start = 0;
  let end = buffer.indexOf(boundaryBuffer, start);
  
  while (end !== -1) {
    if (start !== 0) {
      const part = buffer.slice(start, end);
      const headerEnd = part.indexOf('\r\n\r\n');
      
      if (headerEnd !== -1) {
        const headers = part.slice(0, headerEnd).toString();
        const body = part.slice(headerEnd + 4);
        
        // Content-Type이 image인 경우만 처리
        if (headers.includes('Content-Type: image/')) {
          parts.push({
            headers,
            body: body.slice(0, body.length - 2) // 끝의 \r\n 제거
          });
        }
      }
    }
    
    start = end + boundaryBuffer.length;
    end = buffer.indexOf(boundaryBuffer, start);
  }
  
  return parts;
}

// Base64 이미지 생성 함수
function createBase64Image(buffer, contentType) {
  const base64 = buffer.toString('base64');
  return `data:${contentType};base64,${base64}`;
}

export default async function handler(req, res) {
  // CORS 헤더 설정
  setCorsHeaders(res);

  // OPTIONS 요청 처리
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET 요청 - 헬스 체크
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'OK',
      message: 'Vision OCR service is ready',
      supportedFormats: ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp'],
      maxFileSize: '10MB',
      model: 'gpt-4o'
    });
  }

  // POST 요청만 허용
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed',
      message: 'Only POST requests are allowed'
    });
  }

  try {
    // Content-Type 확인
    const contentType = req.headers['content-type'] || '';
    
    if (!contentType.includes('multipart/form-data')) {
      return res.status(400).json({
        error: 'Invalid Content-Type',
        message: 'Please upload an image file'
      });
    }

    // boundary 추출
    const boundary = contentType.split('boundary=')[1];
    if (!boundary) {
      return res.status(400).json({
        error: 'Invalid multipart data',
        message: 'Boundary not found'
      });
    }

    // 요청 본문을 Buffer로 읽기
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // 멀티파트 파싱
    const parts = parseMultipart(buffer, boundary);
    
    if (parts.length === 0) {
      return res.status(400).json({
        error: 'No image found',
        message: 'Please upload an image file'
      });
    }

    const imagePart = parts[0];
    const imageContentType = imagePart.headers.match(/Content-Type: (image\/\w+)/)?.[1] || 'image/jpeg';
    
    // 파일 크기 체크 (10MB)
    if (imagePart.body.length > 10 * 1024 * 1024) {
      return res.status(400).json({
        error: 'File too large',
        message: 'Image must be smaller than 10MB'
      });
    }

    console.log(`Image OCR request: ${imageContentType} (${imagePart.body.length} bytes)`);

    // 이미지를 Base64로 변환
    const base64Image = createBase64Image(imagePart.body, imageContentType);

    // GPT Vision API 호출 - 텍스트 추출 + 번역 원스톱
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `이미지에서 텍스트를 추출하고 번역해주세요:
              
1. 먼저 이미지의 모든 텍스트를 정확히 추출하세요
2. 추출된 텍스트가 한국어라면 영어로, 영어라면 한국어로 번역하세요
3. 응답 형식:
   원본 텍스트: [추출된 텍스트]
   번역: [번역된 텍스트]
   
만약 텍스트가 없다면 "텍스트 없음"이라고 응답해주세요.`
            },
            {
              type: 'image_url',
              image_url: {
                url: base64Image
              }
            }
          ]
        }
      ],
      max_tokens: 1500
    });

    const response = completion.choices[0].message.content.trim();

    if (response === '텍스트 없음' || response.toLowerCase().includes('no text found')) {
      return res.status(200).json({
        success: false,
        message: 'No text found in the image',
        data: {
          extractedText: '',
          translatedText: '',
          hasText: false
        }
      });
    }

    // 응답 파싱
    const lines = response.split('\n');
    let extractedText = '';
    let translatedText = '';

    for (const line of lines) {
      if (line.includes('원본 텍스트:') || line.includes('Original text:')) {
        extractedText = line.split(':').slice(1).join(':').trim();
      } else if (line.includes('번역:') || line.includes('Translation:')) {
        translatedText = line.split(':').slice(1).join(':').trim();
      }
    }

    // 파싱 실패 시 전체 응답을 텍스트로 처리
    if (!extractedText && !translatedText) {
      extractedText = response;
      translatedText = response;
    }

    const isKorean = detectKorean(extractedText);

    return res.status(200).json({
      success: true,
      data: {
        extractedText: extractedText,
        translatedText: translatedText,
        hasText: true,
        sourceLanguage: isKorean ? '한국어' : 'English',
        targetLanguage: isKorean ? 'English' : '한국어',
        detectedKorean: isKorean
      },
      meta: {
        filesize: imagePart.body.length,
        contentType: imageContentType,
        timestamp: new Date().toISOString(),
        model: 'gpt-4o',
        tokensUsed: completion.usage.total_tokens
      }
    });

  } catch (error) {
    console.error('Image translation error:', error);
    
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

    return res.status(500).json({
      error: 'Image Translation Failed',
      message: 'An error occurred during image translation'
    });
  }
}
