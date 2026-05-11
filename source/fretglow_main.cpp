#include "daisy_pod.h"
#include "stm32h7xx_hal.h"
#include "core_cm7.h"
#include "hid/logger.h"
#include <stdint.h>

extern uint32_t SystemCoreClock;

using namespace daisy;
using namespace daisy::seed;

DaisyPod hw;
GPIO data_gpio;

// =============================
// HARDWARE CONFIG
// =============================
//
// DaisyPod D10 -> SN74AHCT125N pin 2
// SN74AHCT125N pin 3 -> 470R resistor -> LED green DATA wire
// LED red -> +5V
// LED white -> GND
// DaisyPod GND -> shared GND

static constexpr Pin LED_DATA_PIN = D10;

// Physical strip: 4m * 160 LEDs/m = 640 LEDs.
// The guitar mapping only uses the first 324 LEDs.
#define NUM_LEDS 640

#define STRINGS 6
#define FRETS 12
#define LEDS_PER_ROW 54
#define GUITAR_LEDS (STRINGS * LEDS_PER_ROW)

// If all rows go the same physical direction, leave this 0.
// If you wire rows in a snake pattern later, set this to 1.
#define SNAKE_ROWS 0

// Faulty LED indices found through calibration.
// LED2 = LED1 + 59, so 136 and 195.
const int BAD_LEDS[] = {136, 195};
#define NUM_BAD_LEDS (sizeof(BAD_LEDS) / sizeof(BAD_LEDS[0]))

uint8_t leds[NUM_LEDS][3]; // stored as GRB for WS2812B

GPIO_TypeDef* led_port = nullptr;
uint32_t led_mask = 0;

// =============================
// CONTROLS / STATE
// =============================

bool strip_enabled = true;
bool heartbeat = false;

// 0 = full scale, 1 = roots only, 2 = all mapped frets test
int mode = 0;

// Encoder-controlled brightness.
// Keep LOW for safety. 1-30 is plenty on this strip.
int brightness = 8;

// Timing preset.
// 1 was the stable light-blue/cyan-ish timing.
// Change to 3 if the pink/magenta preset was better.
static int timing_preset = 1;

int current_key = 0;
int current_scale = 0;

int last_key = -1;
int last_scale = -1;
int last_mode = -1;
int last_brightness = -1;
bool last_enabled = false;

// =============================
// MUSIC THEORY DATA
// =============================

const char* KEY_NAMES[12] = {
    "C", "C#", "D", "Eb", "E", "F",
    "F#", "G", "Ab", "A", "Bb", "B"
};

const char* SCALE_NAMES[7] = {
    "Major",
    "NatMinor",
    "MajPent",
    "MinPent",
    "Blues",
    "Dorian",
    "Mixolydian"
};

const int SCALE_LENGTHS[7] = {
    7, 7, 5, 5, 6, 7, 7
};

const int SCALES[7][7] = {
    {0, 2, 4, 5, 7, 9, 11},     // Major
    {0, 2, 3, 5, 7, 8, 10},     // Natural minor
    {0, 2, 4, 7, 9, -1, -1},    // Major pentatonic
    {0, 3, 5, 7, 10, -1, -1},   // Minor pentatonic
    {0, 3, 5, 6, 7, 10, -1},    // Blues
    {0, 2, 3, 5, 7, 9, 10},     // Dorian
    {0, 2, 4, 5, 7, 9, 10}      // Mixolydian
};

// Standard tuning, low E to high E.
const int OPEN_STRINGS[STRINGS] = {
    40, // low E
    45, // A
    50, // D
    55, // G
    59, // B
    64  // high E
};

// 160 LEDs/m = 6.25mm pitch.
// Based on measured fret-center positions.
const int FRET_LED[FRETS] = {
    3, 8, 13, 17, 22, 26,
    29, 33, 36, 39, 42, 48
};

// =============================
// TIMING PRESETS
// =============================

struct TimingPreset
{
    uint32_t t0h_ns;
    uint32_t t1h_ns;
    uint32_t total_ns;
};

TimingPreset presets[] = {
    {400, 800, 1250},  // 0 normal
    {350, 750, 1250},  // 1 stable cyan-ish timing
    {450, 850, 1250},  // 2 slightly longer highs
    {300, 700, 1250},  // 3 stable magenta-ish timing
    {500, 900, 1300},  // 4 wider/slower
};

#define NUM_PRESETS (sizeof(presets) / sizeof(presets[0]))

// =============================
// GPIO PORT MAPPING
// =============================

static GPIO_TypeDef* port_to_gpio(GPIOPort port)
{
    switch(port)
    {
        case PORTA: return GPIOA;
        case PORTB: return GPIOB;
        case PORTC: return GPIOC;
        case PORTD: return GPIOD;
        case PORTE: return GPIOE;
        case PORTF: return GPIOF;
        case PORTG: return GPIOG;
        case PORTH: return GPIOH;
        case PORTI: return GPIOI;
#ifdef GPIOJ
        case PORTJ: return GPIOJ;
#endif
#ifdef GPIOK
        case PORTK: return GPIOK;
#endif
        default: return nullptr;
    }
}

static inline void pin_high()
{
    led_port->BSRR = led_mask;
}

static inline void pin_low()
{
    led_port->BSRR = (led_mask << 16);
}

// =============================
// DWT CYCLE COUNTER
// =============================

static void init_cycle_counter()
{
    CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
    DWT->CYCCNT = 0;
    DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk;
}

static inline uint32_t ns_to_cycles(uint32_t ns)
{
    return (uint32_t)(((uint64_t)SystemCoreClock * ns) / 1000000000ULL);
}

static inline void wait_until(uint32_t target)
{
    while((int32_t)(DWT->CYCCNT - target) < 0) {}
}

// =============================
// LED BUFFER HELPERS
// =============================

static void set_rgb(int i, uint8_t r, uint8_t g, uint8_t b)
{
    if(i < 0 || i >= NUM_LEDS)
        return;

    // Store as GRB for WS2812B.
    leds[i][0] = g;
    leds[i][1] = r;
    leds[i][2] = b;
}

static void clear_leds()
{
    for(int i = 0; i < NUM_LEDS; i++)
    {
        set_rgb(i, 0, 0, 0);
    }
}

static void force_bad_leds_off()
{
    for(int i = 0; i < (int)NUM_BAD_LEDS; i++)
    {
        int idx = BAD_LEDS[i];

        if(idx >= 0 && idx < NUM_LEDS)
        {
            leds[idx][0] = 0; // G
            leds[idx][1] = 0; // R
            leds[idx][2] = 0; // B
        }
    }
}

static int clamp_int(int x, int lo, int hi)
{
    if(x < lo) return lo;
    if(x > hi) return hi;
    return x;
}

// =============================
// WS2812B DRIVER
// =============================
//
// WS2812B takes GRB order, high bit first.
// Direct GPIO writes are used for stable timing.

static inline void send_bit(bool bit)
{
    TimingPreset p = presets[timing_preset];

    const uint32_t T0H = ns_to_cycles(p.t0h_ns);
    const uint32_t T1H = ns_to_cycles(p.t1h_ns);
    const uint32_t TT  = ns_to_cycles(p.total_ns);

    uint32_t start = DWT->CYCCNT;

    pin_high();

    if(bit)
        wait_until(start + T1H);
    else
        wait_until(start + T0H);

    pin_low();

    wait_until(start + TT);
}

static inline void send_byte(uint8_t b)
{
    for(int i = 7; i >= 0; --i)
    {
        send_bit((b >> i) & 1);
    }
}

static void show_leds()
{
    // Force faulty LEDs off immediately before every frame.
    force_bad_leds_off();

    __disable_irq();

    for(int i = 0; i < NUM_LEDS; i++)
    {
        send_byte(leds[i][0]); // Green
        send_byte(leds[i][1]); // Red
        send_byte(leds[i][2]); // Blue
    }

    __enable_irq();

    pin_low();
    hw.DelayMs(2);
}

// =============================
// GUITAR MAPPING
// =============================

static int pitch_class_for_position(int string_idx, int fret_idx)
{
    // fret_idx 0 means fret 1, so add +1.
    return (OPEN_STRINGS[string_idx] + fret_idx + 1) % 12;
}

static bool in_scale(int pc, int key, int scale_idx)
{
    int rel = (pc - key + 12) % 12;
    int len = SCALE_LENGTHS[scale_idx];

    for(int i = 0; i < len; i++)
    {
        if(SCALES[scale_idx][i] == rel)
            return true;
    }

    return false;
}

static int led_index_for_position(int string_idx, int fret_idx)
{
    int row_base = string_idx * LEDS_PER_ROW;
    int fret_led = FRET_LED[fret_idx];

#if SNAKE_ROWS
    if(string_idx % 2 == 1)
    {
        fret_led = (LEDS_PER_ROW - 1) - fret_led;
    }
#endif

    return row_base + fret_led;
}

static void draw_scale_map()
{
    clear_leds();

    if(!strip_enabled)
        return;

    for(int s = 0; s < STRINGS; s++)
    {
        for(int f = 0; f < FRETS; f++)
        {
            int pc = pitch_class_for_position(s, f);
            int idx = led_index_for_position(s, f);

            if(mode == 2)
            {
                // All mapped fret positions test mode.
                set_rgb(idx, brightness, brightness, brightness);
            }
            else if(pc == current_key)
            {
                // Root note = red.
                set_rgb(idx, brightness, 0, 0);
            }
            else if(mode == 0 && in_scale(pc, current_key, current_scale))
            {
                // Scale tone = blue/cyan.
                set_rgb(idx, 0, brightness / 3, brightness);
            }
            else
            {
                set_rgb(idx, 0, 0, 0);
            }
        }
    }
}

// =============================
// CONTROL HELPERS
// =============================

static int knob_to_index(float v, int count)
{
    int idx = (int)(v * (float)count);

    if(idx < 0)
        idx = 0;

    if(idx >= count)
        idx = count - 1;

    return idx;
}

static const char* mode_name()
{
    if(mode == 0)
        return "FullScale";

    if(mode == 1)
        return "RootsOnly";

    if(mode == 2)
        return "AllMapped";

    return "Unknown";
}

static void print_state()
{
    hw.seed.PrintLine(
        "enabled=%d | key=%s(%d) | scale=%s(%d) | mode=%s(%d) | brightness=%d | timing=%d | disabled_leds=[%d,%d]",
        strip_enabled ? 1 : 0,
        KEY_NAMES[current_key],
        current_key,
        SCALE_NAMES[current_scale],
        current_scale,
        mode_name(),
        mode,
        brightness,
        timing_preset,
        BAD_LEDS[0],
        BAD_LEDS[1]
    );
}

static void update_controls()
{
    hw.ProcessAllControls();

    // Pot 1 = key.
    float k1 = hw.GetKnobValue(DaisyPod::KNOB_1);
    current_key = knob_to_index(k1, 12);

    // Pot 2 = scale.
    float k2 = hw.GetKnobValue(DaisyPod::KNOB_2);
    current_scale = knob_to_index(k2, 7);

    // Encoder = brightness.
    int inc = hw.encoder.Increment();
    if(inc != 0)
    {
        brightness += inc;
        brightness = clamp_int(brightness, 1, 30);
    }

    // Button 1 = strip on/off.
    if(hw.button1.RisingEdge())
    {
        strip_enabled = !strip_enabled;
    }

    // Button 2 = mode.
    if(hw.button2.RisingEdge())
    {
        mode = (mode + 1) % 3;
    }
}

static bool state_changed()
{
    return current_key != last_key ||
           current_scale != last_scale ||
           mode != last_mode ||
           brightness != last_brightness ||
           strip_enabled != last_enabled;
}

static void remember_state()
{
    last_key = current_key;
    last_scale = current_scale;
    last_mode = mode;
    last_brightness = brightness;
    last_enabled = strip_enabled;
}

static void update_pod_leds()
{
    // LED 1 = heartbeat red.
    if(heartbeat)
        hw.led1.Set(1.0f, 0.0f, 0.0f);
    else
        hw.led1.Set(0.0f, 0.0f, 0.0f);

    // LED 2 = status.
    // Off = strip disabled.
    // Green = full scale.
    // Blue = roots only.
    // Yellow = all mapped frets test.
    if(!strip_enabled)
    {
        hw.led2.Set(0.0f, 0.0f, 0.0f);
    }
    else if(mode == 0)
    {
        hw.led2.Set(0.0f, 1.0f, 0.0f);
    }
    else if(mode == 1)
    {
        hw.led2.Set(0.0f, 0.0f, 1.0f);
    }
    else
    {
        hw.led2.Set(1.0f, 1.0f, 0.0f);
    }

    hw.UpdateLeds();
}

// =============================
// MAIN
// =============================

int main(void)
{
    hw.Init();

    // USB serial logging.
    // View with:
    //   ls /dev/tty.usbmodem*
    //   screen /dev/tty.usbmodemXXXX 115200
    hw.seed.StartLog(true);
    hw.seed.PrintLine("LEDGuitar boot");

    hw.StartAdc();

    data_gpio.Init(LED_DATA_PIN,
                   GPIO::Mode::OUTPUT,
                   GPIO::Pull::NOPULL,
                   GPIO::Speed::VERY_HIGH);

    led_port = port_to_gpio(LED_DATA_PIN.port);
    led_mask = (1UL << LED_DATA_PIN.pin);

    init_cycle_counter();

    pin_low();

    clear_leds();
    show_leds();

    int heartbeat_tick = 0;
    int clear_tick = 0;

    print_state();

    while(1)
    {
        update_controls();

        if(state_changed())
        {
            draw_scale_map();
            show_leds();
            remember_state();
            update_pod_leds();
            print_state();
        }

        // Heartbeat every ~500 ms.
        heartbeat_tick++;
        if(heartbeat_tick >= 25)
        {
            heartbeat_tick = 0;
            heartbeat = !heartbeat;
            update_pod_leds();
        }

        // If disabled, periodically send clear frames.
        if(!strip_enabled)
        {
            clear_tick++;
            if(clear_tick >= 25)
            {
                clear_tick = 0;
                clear_leds();
                show_leds();
            }
        }
        else
        {
            clear_tick = 0;
        }

        hw.DelayMs(20);
    }
}
