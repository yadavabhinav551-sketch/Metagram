from pathlib import Path
from PIL import Image, ImageDraw

icons_dir = Path('public/icons')
icons_dir.mkdir(parents=True, exist_ok=True)

def create_iphone_calculator_icon(size=1024):
    # Master image with RGBA
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))

    # 1. Base Squircle Container (Authentic iPhone Dark Grey Background)
    bg_color = (23, 23, 28, 255)
    radius = int(size * 0.225)

    # Draw solid rounded squircle background
    mask = Image.new('L', (size, size), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle((0, 0, size, size), radius=radius, fill=255)

    bg_layer = Image.new('RGBA', (size, size), bg_color)
    img.paste(bg_layer, (0, 0), mask)

    d = ImageDraw.Draw(img)

    # Subtle inner border for crispness on all screens
    border_w = int(size * 0.006)
    d.rounded_rectangle((border_w, border_w, size - border_w, size - border_w),
                        radius=radius - border_w,
                        outline=(255, 255, 255, 20), width=border_w)

    # 2. iPhone Calculator Screen Area (Top Window)
    screen_x1 = int(size * 0.12)
    screen_y1 = int(size * 0.10)
    screen_x2 = int(size * 0.88)
    screen_y2 = int(size * 0.28)
    screen_r = int(size * 0.04)

    d.rounded_rectangle((screen_x1, screen_y1, screen_x2, screen_y2),
                        radius=screen_r, fill=(10, 10, 14, 255), outline=(40, 40, 48, 255), width=2)

    # 3. iPhone Key Grid Proportions (3 function/num columns + 1 orange op column)
    btn_r = int(size * 0.072)          # Button radius
    start_x = int(size * 0.20)         # Col 0 center
    start_y = int(size * 0.41)         # Row 0 center
    spacing_x = int(size * 0.20)       # Horizontal gap
    spacing_y = int(size * 0.128)      # Vertical gap

    func_color = (165, 165, 165, 255)  # Light silver/grey (AC, +/-, %)
    num_color = (51, 51, 56, 255)      # Dark graphite (0-9, .)
    op_color = (255, 159, 10, 255)     # Authentic iOS Orange (÷, ×, -, +, =)

    # Function to draw perfect circles / pills
    def draw_key(cx, cy, r_val, fill_col, is_pill=False):
        if is_pill:
            # Wide zero button pill
            left = cx - r_val
            right = cx + spacing_x + r_val
            top = cy - r_val
            bottom = cy + r_val
            d.rounded_rectangle((left, top, right, bottom), radius=r_val, fill=fill_col)
        else:
            d.ellipse((cx - r_val, cy - r_val, cx + r_val, cy + r_val), fill=fill_col)

    # Row 0: Light Silver function keys (AC, +/-, %)
    for col in range(3):
        x = start_x + col * spacing_x
        y = start_y
        draw_key(x, y, btn_r, func_color)

    # Right column: iOS Orange operators (÷, ×, -, +, =)
    for row in range(5):
        x = start_x + 3 * spacing_x
        y = start_y + row * spacing_y
        draw_key(x, y, btn_r, op_color)

    # Rows 1-3: Dark graphite number keys (7-8-9, 4-5-6, 1-2-3)
    for row in range(1, 4):
        for col in range(3):
            x = start_x + col * spacing_x
            y = start_y + row * spacing_y
            draw_key(x, y, btn_r, num_color)

    # Row 4: Bottom zero pill & dot
    zero_y = start_y + 4 * spacing_y
    draw_key(start_x, zero_y, btn_r, num_color, is_pill=True)
    draw_key(start_x + 2 * spacing_x, zero_y, btn_r, num_color)

    return img

main_icon = create_iphone_calculator_icon(1024)

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

# Generate public/icon.svg (Authentic iPhone Calculator SVG)
svg_content = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#17171c"/>
  <rect x="2" y="2" width="124" height="124" rx="26" fill="none" stroke="#ffffff" stroke-opacity="0.08" stroke-width="1"/>
  <rect x="15" y="13" width="98" height="23" rx="5" fill="#0a0a0e" stroke="#282830" stroke-width="1"/>

  <circle cx="26" cy="52" r="9" fill="#a5a5a5"/>
  <circle cx="51" cy="52" r="9" fill="#a5a5a5"/>
  <circle cx="76" cy="52" r="9" fill="#a5a5a5"/>
  <circle cx="101" cy="52" r="9" fill="#ff9f0a"/>

  <circle cx="26" cy="68" r="9" fill="#333338"/>
  <circle cx="51" cy="68" r="9" fill="#333338"/>
  <circle cx="76" cy="68" r="9" fill="#333338"/>
  <circle cx="101" cy="68" r="9" fill="#ff9f0a"/>

  <circle cx="26" cy="84" r="9" fill="#333338"/>
  <circle cx="51" cy="84" r="9" fill="#333338"/>
  <circle cx="76" cy="84" r="9" fill="#333338"/>
  <circle cx="101" cy="84" r="9" fill="#ff9f0a"/>

  <rect x="17" y="91" width="43" height="18" rx="9" fill="#333338"/>
  <circle cx="76" cy="100" r="9" fill="#333338"/>
  <circle cx="101" cy="100" r="9" fill="#ff9f0a"/>
</svg>'''

with open(Path('public/icon.svg'), 'w', encoding='utf-8') as f:
    f.write(svg_content)
print("Generated public/icon.svg")
