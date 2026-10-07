from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

icons_dir = Path('public/icons')
icons_dir.mkdir(parents=True, exist_ok=True)

def create_calculator_icon(size=1024):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Base rounded square (iOS Dark Style)
    radius = int(size * 0.22)
    bg_color = (24, 24, 28, 255)
    d.rounded_rectangle((0, 0, size, size), radius=radius, fill=bg_color)

    # Subtle inner border shadow
    border_color = (45, 45, 52, 255)
    d.rounded_rectangle((4, 4, size - 4, size - 4), radius=radius - 4, outline=border_color, width=int(size * 0.008))

    # Calculator Screen Area
    screen_margin_x = int(size * 0.12)
    screen_top = int(size * 0.12)
    screen_height = int(size * 0.18)
    screen_box = (screen_margin_x, screen_top, size - screen_margin_x, screen_top + screen_height)
    d.rounded_rectangle(screen_box, radius=int(size * 0.05), fill=(40, 40, 46, 255), outline=(60, 60, 70, 255), width=2)

    # Key grid setup
    btn_radius = int(size * 0.075)
    start_x = int(size * 0.22)
    start_y = int(size * 0.40)
    spacing_x = int(size * 0.19)
    spacing_y = int(size * 0.135)

    dark_fill = (58, 58, 62, 255)
    light_fill = (165, 165, 165, 255)
    orange_fill = (255, 159, 10, 255)

    # Row 0: Top function keys (C, +/-, %)
    for col in range(3):
        x = start_x + col * spacing_x
        y = start_y
        d.ellipse((x - btn_radius, y - btn_radius, x + btn_radius, y + btn_radius), fill=light_fill)

    # Right operator keys (÷, ×, -, +, =)
    for row in range(5):
        x = start_x + 3 * spacing_x
        y = start_y + row * spacing_y
        d.ellipse((x - btn_radius, y - btn_radius, x + btn_radius, y + btn_radius), fill=orange_fill)

    # Number grid (7-8-9, 4-5-6, 1-2-3)
    for row in range(1, 4):
        for col in range(3):
            x = start_x + col * spacing_x
            y = start_y + row * spacing_y
            d.ellipse((x - btn_radius, y - btn_radius, x + btn_radius, y + btn_radius), fill=dark_fill)

    # Bottom Zero button (wide pill)
    zero_y = start_y + 4 * spacing_y
    zero_x1 = start_x - btn_radius
    zero_x2 = start_x + spacing_x + btn_radius
    d.rounded_rectangle((zero_x1, zero_y - btn_radius, zero_x2, zero_y + btn_radius), radius=btn_radius, fill=dark_fill)

    # Bottom Dot button
    dot_x = start_x + 2 * spacing_x
    d.ellipse((dot_x - btn_radius, zero_y - btn_radius, dot_x + btn_radius, zero_y + btn_radius), fill=dark_fill)

    return img

main_icon = create_calculator_icon(1024)

# Save various icon sizes
sizes = {
    'ios-calculator-icon.png': 512,
    'calculator-192.png': 192,
    'calculator-512.png': 512,
    'calculator-maskable-192.png': 192,
    'calculator-maskable-512.png': 512,
    'calculator-splash-512.png': 512,
    'icon-192.png': 192,
    'icon-512.png': 512,
    'maskable-192.png': 192,
    'maskable-512.png': 512,
    'splash-512.png': 512,
}

for filename, sz in sizes.items():
    resized = main_icon.resize((sz, sz), Image.Resampling.LANCZOS)
    resized.save(icons_dir / filename)
    print(f"Generated {filename} ({sz}x{sz})")

# Generate public/icon.svg
svg_content = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#18181c"/>
  <rect x="16" y="14" width="96" height="24" rx="6" fill="#28282e" stroke="#3c3c46" stroke-width="1.5"/>
  <circle cx="28" cy="52" r="9" fill="#a5a5a5"/>
  <circle cx="52" cy="52" r="9" fill="#a5a5a5"/>
  <circle cx="76" cy="52" r="9" fill="#a5a5a5"/>
  <circle cx="100" cy="52" r="9" fill="#ff9f0a"/>

  <circle cx="28" cy="72" r="9" fill="#3a3a3e"/>
  <circle cx="52" cy="72" r="9" fill="#3a3a3e"/>
  <circle cx="76" cy="72" r="9" fill="#3a3a3e"/>
  <circle cx="100" cy="72" r="9" fill="#ff9f0a"/>

  <circle cx="28" cy="92" r="9" fill="#3a3a3e"/>
  <circle cx="52" cy="92" r="9" fill="#3a3a3e"/>
  <circle cx="76" cy="92" r="9" fill="#3a3a3e"/>
  <circle cx="100" cy="92" r="9" fill="#ff9f0a"/>

  <rect x="19" y="103" width="42" height="18" rx="9" fill="#3a3a3e"/>
  <circle cx="76" cy="112" r="9" fill="#3a3a3e"/>
  <circle cx="100" cy="112" r="9" fill="#ff9f0a"/>
</svg>'''

with open(Path('public/icon.svg'), 'w', encoding='utf-8') as f:
    f.write(svg_content)
print("Generated public/icon.svg")
