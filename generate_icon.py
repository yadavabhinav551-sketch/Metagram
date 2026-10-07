from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

icons_dir = Path('public/icons')
icons_dir.mkdir(parents=True, exist_ok=True)

def create_professional_calculator_icon(size=1024):
    # Master image with RGBA
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 1. Base Squircle Container (iOS 18 Dark Aesthetic)
    radius = int(size * 0.225)
    bg_top = (28, 28, 34, 255)
    bg_bottom = (12, 12, 16, 255)

    # Gradient background
    for y in range(size):
        interp = y / float(size)
        r = int(bg_top[0] + (bg_bottom[0] - bg_top[0]) * interp)
        g = int(bg_top[1] + (bg_bottom[1] - bg_top[1]) * interp)
        b = int(bg_top[2] + (bg_bottom[2] - bg_top[2]) * interp)
        d.line([(0, y), (size, y)], fill=(r, g, b, 255))

    # Mask to rounded squircle
    mask = Image.new('L', (size, size), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle((0, 0, size, size), radius=radius, fill=255)
    img.putalpha(mask)

    d = ImageDraw.Draw(img)

    # Subtle inner border & top glass specular highlight
    border_width = int(size * 0.008)
    d.rounded_rectangle((border_width, border_width, size - border_width, size - border_width),
                        radius=radius - border_width,
                        outline=(255, 255, 255, 30), width=border_width)

    # Glass top edge shine
    d.line([(radius, border_width + 1), (size - radius, border_width + 1)], fill=(255, 255, 255, 60), width=2)

    # 2. Sleek Screen Window (Top LED Display)
    screen_x1 = int(size * 0.08)
    screen_y1 = int(size * 0.08)
    screen_x2 = int(size * 0.92)
    screen_y2 = int(size * 0.26)
    screen_radius = int(size * 0.04)

    # Inner shadow for screen
    d.rounded_rectangle((screen_x1, screen_y1, screen_x2, screen_y2),
                        radius=screen_radius, fill=(8, 8, 12, 255), outline=(45, 45, 55, 255), width=2)

    # Display text simulator - Glowing Orange Number "0" or "1,234"
    # Draw right-aligned sleek math display representation
    calc_orange = (255, 159, 10, 255)
    text_color = (255, 255, 255, 230)

    # Simple crisp LED lines inside screen window
    disp_y = int(screen_y1 + (screen_y2 - screen_y1) * 0.5)
    disp_x_end = int(screen_x2 - size * 0.06)

    # Draw crisp display digits graphic
    # Representing "123" right-aligned
    bar_w = int(size * 0.015)
    bar_h = int(size * 0.06)

    # 3. Key Grid Layout
    btn_r = int(size * 0.085) # Circular radius
    margin_left = int(size * 0.16)
    margin_top = int(size * 0.33)
    spacing_x = int(size * 0.226)
    spacing_y = int(size * 0.128)

    func_color = (165, 165, 170, 255)   # AC, +/-, %
    num_color = (51, 51, 56, 255)        # 0-9, .
    op_color = (255, 159, 10, 255)       # ÷, ×, -, +, =

    # Helper function to draw circular buttons with soft radial gradient
    def draw_button(cx, cy, radius_val, color, is_pill=False, pill_w=0):
        if is_pill:
            box = (cx - radius_val, cy - radius_val, cx + pill_w + radius_val, cy + radius_val)
            d.rounded_rectangle(box, radius=radius_val, fill=color)
            # Top subtle specular highlight
            d.arc((cx - radius_val + 2, cy - radius_val + 2, cx + pill_w + radius_val - 2, cy + radius_val - 2),
                  start=200, end=340, fill=(255, 255, 255, 45), width=int(size * 0.006))
        else:
            box = (cx - radius_val, cy - radius_val, cx + radius_val, cy + radius_val)
            d.ellipse(box, fill=color)
            # Top subtle specular highlight
            d.arc(box, start=200, end=340, fill=(255, 255, 255, 45), width=int(size * 0.006))

    # Row 0: Top function keys (AC, +/-, %)
    for col in range(3):
        x = margin_left + col * spacing_x
        y = margin_top
        draw_button(x, y, btn_r, func_color)

    # Right operator column (÷, ×, -, +, =)
    for row in range(5):
        x = margin_left + 3 * spacing_x
        y = margin_top + row * spacing_y
        draw_button(x, y, btn_r, op_color)

    # Number keys (7-8-9, 4-5-6, 1-2-3)
    for row in range(1, 4):
        for col in range(3):
            x = margin_left + col * spacing_x
            y = margin_top + row * spacing_y
            draw_button(x, y, btn_r, num_color)

    # Bottom Zero button (Pill shape)
    zero_y = margin_top + 4 * spacing_y
    zero_x = margin_left
    draw_button(zero_x, zero_y, btn_r, num_color, is_pill=True, pill_w=spacing_x)

    # Bottom Dot button (.)
    dot_x = margin_left + 2 * spacing_x
    draw_button(dot_x, zero_y, btn_r, num_color)

    return img

main_icon = create_professional_calculator_icon(1024)

# Save web PWA icon sizes
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

# Save Android Studio mipmap icon sizes
android_res = Path('android/app/src/main/res')
mipmap_sizes = {
    'mipmap-mdpi': 48,
    'mipmap-hdpi': 72,
    'mipmap-xhdpi': 96,
    'mipmap-xxhdpi': 144,
    'mipmap-xxxhdpi': 192,
}

for folder, sz in mipmap_sizes.items():
    dir_path = android_res / folder
    dir_path.mkdir(parents=True, exist_ok=True)
    resized = main_icon.resize((sz, sz), Image.Resampling.LANCZOS)
    resized.save(dir_path / 'ic_launcher.png')
    resized.save(dir_path / 'ic_launcher_round.png')
    print(f"Generated Android {folder} icons ({sz}x{sz})")

# Generate public/icon.svg
svg_content = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#1e1e24"/>
      <stop offset="100%" stop-color="#0c0c10"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#bgGrad)"/>
  <rect x="2" y="2" width="124" height="124" rx="26" fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="1.5"/>
  <rect x="12" y="11" width="104" height="24" rx="6" fill="#08080c" stroke="#2d2d38" stroke-width="1"/>

  <circle cx="24" cy="48" r="9.5" fill="#a5a5aa"/>
  <circle cx="52" cy="48" r="9.5" fill="#a5a5aa"/>
  <circle cx="80" cy="48" r="9.5" fill="#a5a5aa"/>
  <circle cx="108" cy="48" r="9.5" fill="#ff9f0a"/>

  <circle cx="24" cy="68" r="9.5" fill="#333338"/>
  <circle cx="52" cy="68" r="9.5" fill="#333338"/>
  <circle cx="80" cy="68" r="9.5" fill="#333338"/>
  <circle cx="108" cy="68" r="9.5" fill="#ff9f0a"/>

  <circle cx="24" cy="88" r="9.5" fill="#333338"/>
  <circle cx="52" cy="88" r="9.5" fill="#333338"/>
  <circle cx="80" cy="88" r="9.5" fill="#333338"/>
  <circle cx="108" cy="88" r="9.5" fill="#ff9f0a"/>

  <rect x="14.5" y="98.5" width="47" height="19" rx="9.5" fill="#333338"/>
  <circle cx="80" cy="108" r="9.5" fill="#333338"/>
  <circle cx="108" cy="108" r="9.5" fill="#ff9f0a"/>
</svg>'''

with open(Path('public/icon.svg'), 'w', encoding='utf-8') as f:
    f.write(svg_content)
print("Generated public/icon.svg")
