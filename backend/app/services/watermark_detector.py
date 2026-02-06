"""
Watermark detection service for AI text detection
"""

class WatermarkDetector:
    def __init__(self):
        self.secret = "ASKVOX"
    
    def check_watermark(self, text: str) -> dict:
        """Check for ALL watermark types and return detection results"""
        results = {
            'has_watermark': False,
            'cyrillic': 0,
            'zero_width': 0,
            'thin_spaces': 0,
            'total_markers': 0,
            'ai_percentage': 0,
            'human_percentage': 0,
            'watermarked_positions': []
        }
        
        if not text or len(text) == 0:
            return results
        
        # Track watermarked character positions
        watermarked_positions = []
        
        # Count Cyrillic lookalikes and track positions
        cyrillic_chars = 'аеоісАЕОІС'
        for i, char in enumerate(text):
            if char in cyrillic_chars:
                watermarked_positions.append(i)
                results['cyrillic'] += 1
        
        # Count zero-width characters and track positions
        zero_width_chars = ['\u200b', '\u200c', '\u200d', '\ufeff']
        for i, char in enumerate(text):
            if char in zero_width_chars:
                watermarked_positions.append(i)
                results['zero_width'] += 1

        # Count thin spaces and track positions
        thin_space_chars = ['\u2009', '\u200a', '\u202f']
        for i, char in enumerate(text):
            if char in thin_space_chars:
                watermarked_positions.append(i)
                results['thin_spaces'] += 1
        
        results['watermarked_positions'] = sorted(watermarked_positions)
        
        # Total markers
        results['total_markers'] = results['cyrillic'] + results['zero_width'] + results['thin_spaces']
        
        # Has watermark if any markers found
        results['has_watermark'] = results['total_markers'] > 0
        
        # Calculate AI percentage based on markers (strict: any marker => AI)
        if results['has_watermark']:
            # If we see any watermark markers, treat as AI with high confidence
            results['ai_percentage'] = 95
            results['human_percentage'] = 5
        else:
            # No markers found -> lean human
            results['ai_percentage'] = 20
            results['human_percentage'] = 80
        
        return results
    
    def analyze_text(self, text: str) -> dict:
        """Main analysis function that returns formatted results"""
        detection = self.check_watermark(text)
        
        return {
            'has_watermark': detection['has_watermark'],
            'ai_percentage': detection['ai_percentage'],
            'human_percentage': detection['human_percentage'],
            'details': {
                'cyrillic_count': detection['cyrillic'],
                'zero_width_count': detection['zero_width'],
                'thin_spaces_count': detection['thin_spaces'],
                'total_markers': detection['total_markers'],
                'text_length': len(text),
                'watermarked_positions': detection['watermarked_positions']
            }
        }
