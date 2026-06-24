from pathlib import Path
from PIL import Image, ImageDraw

icons = Path('public/icons')
icons.mkdir(parents=True, exist_ok=True)
size = 1024
img = Image.new('RGBA', (size, size), (244, 244, 247, 255))
d = ImageDraw.Draw(img)

# outer rounded square
outer_radius = 220
d.rounded_rectangle((0, 0, size, size), radius=outer_radius, fill=(244, 244, 247, 255))
for offset in range(1, 16):
    alpha = max(0, 24 - offset)
    d.rounded_rectangle(
        (offset, offset, size - offset, size - offset),
        radius=outer_radius - offset,
        outline=(200, 200, 204, alpha)
    )

# calculator body
body = (size * 0.16, size * 0.10, size * 0.84, size * 0.90)
d.rounded_rectangle(body, radius=180, fill=(57, 57, 60, 255))

# screen area
screen = (size * 0.22, size * 0.14, size * 0.78, size * 0.29)
d.rounded_rectangle(screen, radius=92, fill=(118, 118, 124, 255))
d.rounded_rectangle((screen[0] + 4, screen[1] + 4, screen[2] - 4, screen[3] - 4), radius=80, fill=(89, 89, 95, 255))

# button helpers
button_radius = 72
button_spacing = size * 0.18
start_x = size * 0.26
start_y = size * 0.40
white_fill = (245, 245, 248, 255)
white_outline = (210, 210, 214, 255)
orange_fill = (255, 153, 51, 255)
orange_outline = (200, 111, 19, 255)

# left and center white buttons (4 rows, 3 cols), skip the bottom-right dot position
for row in range(4):
    for col in range(3):
        if row == 3 and col == 2:
            continue
        x = start_x + col * button_spacing
        y = start_y + row * size * 0.13
        d.ellipse((x - button_radius, y - button_radius, x + button_radius, y + button_radius), fill=white_fill, outline=white_outline, width=8)

# orange right buttons
for row in range(3):
    x = size * 0.74
    y = start_y + row * size * 0.13
    d.ellipse((x - button_radius, y - button_radius, x + button_radius, y + button_radius), fill=orange_fill, outline=orange_outline, width=8)

# bottom wide zero button
zero_left = start_x - button_radius
zero_right = start_x + button_spacing * 2 + button_radius
zero_y = start_y + 3 * size * 0.13
zero_box = (zero_left, zero_y - button_radius, zero_right, zero_y + button_radius)
d.rounded_rectangle(zero_box, radius=96, fill=white_fill, outline=white_outline, width=8)

# bottom dot button
dot_x = size * 0.74
dot_y = zero_y
d.ellipse((dot_x - button_radius, dot_y - button_radius, dot_x + button_radius, dot_y + button_radius), fill=white_fill, outline=white_outline, width=8)

# subtle highlight on calculator body
highlight = Image.new('RGBA', (size, size), (255, 255, 255, 0))
hd = ImageDraw.Draw(highlight)
hd.rounded_rectangle((body[0] + 16, body[1] + 16, body[2] - 16, body[1] + 120), radius=90, fill=(255, 255, 255, 25))
img = Image.alpha_composite(img, highlight)

img.save(icons / 'ios-calculator-icon.png')
print('created', icons / 'ios-calculator-icon.png')
