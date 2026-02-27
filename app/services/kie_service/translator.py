from googletrans import Translator
import logging

logger = logging.getLogger(__name__)


class TranslatorService:
    def __init__(self):
        self.translator = Translator()
    
    async def translate_to_en(self, text: str) -> str:
        try:
            if not text or not text.strip():
                return text
            
            text = text.strip()
            
            result = self.translator.translate(text, src='auto', dest='en')
            
            detected_lang = result.src
            translated_text = result.text
            
            if detected_lang == 'en':
                logger.info(f"Text is already in English: '{text[:50]}...'")
                return text
            
            logger.info(f"Detected language: {detected_lang} | Translated: '{text[:50]}...' -> '{translated_text[:50]}...'")
            return translated_text
            
        except Exception as e:
            logger.error(f"Translation error: {e}", exc_info=True)
            return text
    
    async def translate_ru_to_en(self, text: str) -> str:

        return await self.translate_to_en(text)
    
    def detect_language(self, text: str) -> str:

        try:
            if not text or not text.strip():
                return 'unknown'
            
            result = self.translator.detect(text)
            logger.info(f"Detected language: {result.lang} (confidence: {result.confidence})")
            return result.lang
            
        except Exception as e:
            logger.error(f"Language detection error: {e}")
            return 'unknown'


translator_service = TranslatorService()