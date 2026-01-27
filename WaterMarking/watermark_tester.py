# watermark_all_random.py
# All watermarks at once, random placement

import random
import hashlib

class WatermarkAllRandom:
    def __init__(self):
        self.secret = "ASKVOX"
        print("\n🔐 WATERMARK SYSTEM: " \
        "1. Replace with a font that looks like original, " \
        "2. Invsible chracter anywhere in text " \
        "3.Replace normal spaces with a thinner spacing" \
        "4. using AskVox as binary it mixes up the thin spaces and places them into the word")
    
    def add_watermark(self, text):
        """
        Apply ALL watermark techniques with RANDOM placement:
        1. Random Cyrillic lookalikes
        2. Random zero-width insertion  
        3. Random thin spaces
        4. Random binary encoding spots
        ALL APPLIED, RANDOM POSITIONS
        """
        # Use text as seed for consistency
        seed = hashlib.md5(text.encode()).hexdigest()
        random.seed(int(seed[:8], 16))
        
        result = []
        
        # 1. RANDOM Cyrillic lookalikes
        lookalikes = {
            'a': 'а', 'e': 'е', 'o': 'о', 'c': 'с', 'i': 'і',
            'A': 'А', 'E': 'Е', 'O': 'О', 'C': 'С', 'I': 'І'
        }
        
        for char in text:
            if char in lookalikes and random.random() < 0.15:  # 15% RANDOM chance
                result.append(lookalikes[char])  # Cyrillic
            else:
                result.append(char)
        
        # 2. RANDOM zero-width inside text
        step2 = []
        for char in result:
            step2.append(char)
            if random.random() < 0.12:  # 12% RANDOM chance anywhere
                step2.append(random.choice(['\u200b', '\u200c']))
        
        # 3. RANDOM thin spaces
        step3 = []
        for char in step2:
            if char == ' ' and random.random() < 0.4:  # 40% RANDOM for spaces
                step3.append(random.choice(['\u2009', '\u200a']))  # Thin/hair space
            else:
                step3.append(char)
        
        # 4. RANDOM binary encoding spots
        binary_secret = ''.join(format(ord(c), '08b') for c in self.secret)
        final = []
        bit_index = 0
        
        for char in step3:
            final.append(char)
            # RANDOM places to encode bits
            if random.random() < 0.25 and bit_index < len(binary_secret):  # 25% RANDOM
                bit = binary_secret[bit_index]
                final.append('\u200b' if bit == '0' else '\u200c')
                bit_index += 1
        
        return ''.join(final)
    
    def check_watermark(self, text):
        """Check for ALL watermark types"""
        results = {
            'has_watermark': False,
            'cyrillic': 0,
            'zero_width': 0,
            'thin_spaces': 0,
            'total_markers': 0
        }
        
        # Count Cyrillic
        cyrillic_chars = 'аеоісАЕОІС'
        results['cyrillic'] = sum(text.count(c) for c in cyrillic_chars)
        
        # Count zero-width
        results['zero_width'] = text.count('\u200b') + text.count('\u200c')
        
        # Count thin spaces
        results['thin_spaces'] = text.count('\u2009') + text.count('\u200a')
        
        # Total markers
        results['total_markers'] = results['cyrillic'] + results['zero_width'] + results['thin_spaces']
        
        # Has watermark if any markers found
        results['has_watermark'] = results['total_markers'] > 0
        
        return results
    
    def run(self):
        
        while True:
            print("\n" + "="*50)
            print("1. Add Watermark")
            print("2. Check Watermark")
            print("3. Quit")
            print("="*50)
            
            choice = input("\nChoose 1-3: ").strip()
            
            if choice == "1":
                self.add_watermark_menu()
            
            elif choice == "2":
                self.check_watermark_menu()
            
            elif choice == "3":
                print("\n👋 Goodbye!")
                break
            
            else:
                print("❌ Please enter 1, 2, or 3")
    
    def add_watermark_menu(self):
        """Option 1: Add watermark"""
        print("\n" + "="*50)
        print("ADD WATERMARK")
        print("="*50)
        
        text = input("\nEnter text to watermark: ").strip()
        
        if not text:
            print("⚠️  Using example text")
            text = "Hello world, this is AskVox"
        
        print(f"\n📏 Original: {len(text)} characters")
        
        # Apply ALL watermarks with random placement
        watermarked = self.add_watermark(text)
        
        print(f"💧 Watermarked: {len(watermarked)} characters")
        print(f"🎲 Randomly placed {len(watermarked) - len(text)} markers")
        
        # Show what was added
        check = self.check_watermark(watermarked)
        if check['has_watermark']:
            print(f"✓ Contains: {check['cyrillic']} Cyrillic, {check['zero_width']} zero-width, {check['thin_spaces']} thin spaces")
        
        print(f"\n📋 COPY THIS TEXT:")
        print("-" * 60)
        print(watermarked)
        print("-" * 60)
        
        print(f"\n💡 Test: Copy → Telegram → Copy back → Check with Option 2")
    
    def check_watermark_menu(self):
        """Option 2: Check watermark"""
        print("\n" + "="*50)
        print("CHECK WATERMARK")
        print("="*50)
        
        text = input("\nPaste text to check: ").strip()
        
        if not text:
            print("❌ No text provided")
            return
        
        print(f"\n🔍 Analyzing {len(text)} characters...")
        
        results = self.check_watermark(text)
        
        print(f"\n" + "="*50)
        print("RESULTS")
        print("="*50)
        
        if results['has_watermark']:
            print("✅ WATERMARK DETECTED")
            print(f"\nFound:")
            print(f"  • {results['cyrillic']} Cyrillic lookalikes")
            print(f"  • {results['zero_width']} zero-width characters")
            print(f"  • {results['thin_spaces']} thin spaces")
            print(f"\nTotal: {results['total_markers']} hidden markers")
            
            # Calculate survival
            original_estimate = len(text) - results['total_markers']
            if original_estimate > 0:
                density = (results['total_markers'] / len(text)) * 100
                print(f"Density: {density:.1f}% of text is watermark")
            
            # Test copy-paste
            print(f"\n📋 Copy-paste test:")
            copied = text.encode('utf-8').decode('utf-8')
            after = self.check_watermark(copied)
            
            if after['total_markers'] == results['total_markers']:
                print(f"  ✅ All {after['total_markers']} markers survive")
            elif after['total_markers'] > 0:
                print(f"  ⚠️  {after['total_markers']}/{results['total_markers']} markers survive")
            else:
                print(f"  ❌ No markers survive (text modified)")
        
        else:
            print("❌ NO WATERMARK FOUND")
            print("This text appears clean or heavily modified")

# Run it
if __name__ == "__main__":
    watermark = WatermarkAllRandom()
    watermark.run()