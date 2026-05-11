# FretGlow Static Project Webpage

This folder contains a plain HTML/CSS/JS project webpage for:

**FretGlow: A DaisyPod-Controlled LED Guitar Fretboard**

The site is designed as a clean, portfolio-style course final project deliverable. It can be opened locally by double-clicking `index.html`; no build step, package install, framework, or local server is required.

## Project Structure

```text
fretglow-webpage/
├── index.html
├── style.css
├── script.js
├── visualizer.html
├── visualizer.css
├── visualizer.js
├── README.md
├── source/
│   ├── fretglow_main.cpp
│   └── fretglow_serial_controller.cpp
└── assets/
    └── .gitkeep
```

## How to Run Locally

1. Open this folder in Finder.
2. Double-click `index.html`.
3. The page should open directly in your browser.

You can also run a simple local server if you prefer:

```bash
python3 -m http.server 8000
```

Then visit:

```text
http://localhost:8000
```

## Live Browser Visualizer

The live visualizer is the fallback demo for the version where the mounted LED strip/data chain became unreliable. It keeps the DaisyPod controls and the same pitch-class fretboard mapping, but renders the state in the browser instead of driving the physical LEDs.

DaisyPod mapping for the browser controller firmware:

- Pot 1 = key
- Pot 2 = scale
- Encoder = brightness
- SW1 / Button 1 = on/off
- SW2 / Button 2 = display mode
- Optional Voice Mode: when enabled in the browser, the same SW2 press also starts a 3-second audio key-detection pass

1. Flash `source/fretglow_serial_controller.cpp` to the DaisyPod using the same libDaisy/DaisyPod build and flash workflow used for `source/fretglow_main.cpp`. This firmware does not drive LEDs; it reads the DaisyPod controls and prints compact JSON over USB serial at 115200 baud.
2. Start a local server from this folder:

```bash
python3 -m http.server 8000
```

3. Open:

```text
http://localhost:8000/visualizer.html
```

4. Use Chrome or Edge. Web Serial is not available in every browser, and it behaves best from localhost.
5. Click **Connect DaisyPod** and choose the DaisyPod serial port.
6. If the port does not appear, unplug/replug the DaisyPod and close any terminal, `screen`, or serial monitor session using the same serial port.

### Refined audio detection

The visualizer also has an optional browser audio input mode. It estimates a pitch class/root from incoming guitar audio and can make a lightweight scale-family guess when the recording contains enough different notes.

1. Open the visualizer through localhost:

```bash
python3 -m http.server 8000
```

```text
http://localhost:8000/visualizer.html
```

2. Use Chrome or Edge.
3. Click **Start Microphone** and grant permission.
4. Choose an audio input device if your browser lists more than one.
5. Play a clear single note or a short simple phrase near the microphone or audio input.
6. Click **Voice Mode Off** to turn Voice Mode on, then press SW2 on the DaisyPod. You can also click **Record 3 sec** in the browser.
7. Root-only detection is the most reliable path. Major/minor/pentatonic inference requires multiple confident pitch classes and may not work from one note.
8. Use **Continuous** only as a secondary mode. It updates the detected note readout and commits only after repeated stable frames.

DaisyPod-triggered audio detection:

1. Flash `source/fretglow_serial_controller.cpp`.
2. Run:

```bash
python3 -m http.server 8000
```

3. Open `http://localhost:8000/visualizer.html` in Chrome or Edge.
4. Click **Start Microphone** and grant permission.
5. Click **Connect DaisyPod** and select the DaisyPod serial port.
6. Turn **Voice Mode** on in the audio panel.
7. Press SW2 on the DaisyPod.
8. Play a clear single note or strong root on guitar during the 3-second recording window.
9. The visualizer key should update to the detected pitch class.
10. Turn **Voice Mode** off when you want SW2 to behave as a normal display-mode button without starting audio detection.
11. Try a short major/minor or pentatonic phrase with the detection mode selector if you want scale-family inference.

Audio detection is pitch-class/root and scale-family estimation, not full chord recognition. Muting unused strings and playing clearly will make it much more stable.

## Adding Your Media

Place your images and video in the `assets/` folder using these filenames:

```text
assets/hero_system.jpg
assets/guitar_demo.jpg
assets/wiring_closeup.jpg
assets/guitar_pieces.png
assets/guitar_code.png
assets/controller_tray.png
assets/fusion_tray.png
assets/demo.mp4
```

The webpage already includes placeholders for each of these files. When a matching image or video exists, `script.js` automatically hides the placeholder and displays the real media.

Recommended media:

- `hero_system.jpg`: best overall photo of the guitar, LEDs, DaisyPod, and controller tray.
- `guitar_demo.jpg`: clear still image of LEDs on the fretboard.
- `wiring_closeup.jpg`: breadboard, level shifter, resistor, capacitor, and power wiring.
- `guitar_pieces.png`: physical build/process photo showing the guitar pieces and LED mounting work.
- `guitar_code.png`: firmware or serial-log screenshot for the code section.
- `controller_tray.png`: photo of the red 3D printed tray with DaisyPod and breadboard. A `.jpg` is also fine if you update the image path in `index.html`.
- `fusion_tray.png`: Fusion 360, CAD, slicer, or Bambu Lab screenshot.
- `demo.mp4`: final demo video.

The system block diagram is drawn directly in HTML/CSS, so it does not require a separate image file.

## Editing Text

Most of the project copy is already drafted in `index.html`. Search for the HTML comments that begin with:

```html
<!-- Replace ...
```

Those comments mark the fastest places to update media, captions, links, and project-specific details.

Update the footer near the bottom of `index.html`:

```html
Created by <span class="editable-name">Your Name</span>.
```

Replace `Your Name` with your name and add your course or lab attribution.

## Project Files / Downloads

The "Files / Source" section links to the included firmware file:

```text
source/fretglow_main.cpp
```

Replace the remaining `href="#"` values with real files or links before submitting, such as:

- Firmware source code
- CAD / STL files
- Wiring diagram
- Final report PDF

If files are local, put them in `assets/` or a new folder such as `downloads/`, then update the links.

## Submission Tip

Before zipping the folder:

1. Open `index.html` locally.
2. Check that all image placeholders have been replaced by real media where possible.
3. Play the demo video.
4. Test the sticky navigation links.
5. Confirm your name, course, and year are correct in the footer.

Then zip the whole folder and submit it.
