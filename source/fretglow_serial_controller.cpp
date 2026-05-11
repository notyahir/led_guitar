#include "daisy_pod.h"
#include "hid/logger.h"
#include <stdint.h>

using namespace daisy;

DaisyPod hw;

// Browser visualizer fallback firmware.
// This keeps the DaisyPod control mapping and music state alive without driving
// the physical WS2812B strip. The browser reads one JSON object per USB line.

static constexpr int NUM_KEYS = 12;
static constexpr int NUM_SCALES = 7;
static constexpr int NUM_MODES = 3;
static constexpr int MIN_BRIGHTNESS = 1;
static constexpr int MAX_BRIGHTNESS = 30;
static constexpr int DEFAULT_BRIGHTNESS = 8;

struct ControllerState
{
    int key = 0;
    int scale = 0;
    int mode = 0;
    int brightness = DEFAULT_BRIGHTNESS;
    int audioTrigger = 0;
    bool enabled = true;
};

ControllerState state;
ControllerState last_printed_state;
bool have_printed_state = false;
bool heartbeat = false;

static int knob_to_index(float value, int count)
{
    int index = (int)(value * (float)count);

    if(index < 0)
        index = 0;

    if(index >= count)
        index = count - 1;

    return index;
}

static bool states_equal(const ControllerState& a, const ControllerState& b)
{
    return a.key == b.key &&
           a.scale == b.scale &&
           a.mode == b.mode &&
           a.brightness == b.brightness &&
           a.audioTrigger == b.audioTrigger &&
           a.enabled == b.enabled;
}

static void print_state()
{
    // Keep this JSON short. Daisy logger buffers can truncate long strings, so
    // names are computed in the browser from these numeric fields.
    //
    // Example:
    // {"type":"state","key":5,"scale":0,"mode":0,"enabled":1,"brightness":8,"audioTrigger":0}
    hw.seed.PrintLine(
        "{\"type\":\"state\",\"key\":%d,\"scale\":%d,\"mode\":%d,\"enabled\":%d,\"brightness\":%d,\"audioTrigger\":%d}",
        state.key,
        state.scale,
        state.mode,
        state.enabled ? 1 : 0,
        state.brightness,
        state.audioTrigger
    );

    last_printed_state = state;
    have_printed_state = true;
}

static void print_audio_trigger_event()
{
    // Short event for optional browser Voice Mode. The following state line also
    // carries audioTrigger, so the browser can ignore duplicates safely.
    hw.seed.PrintLine(
        "{\"type\":\"audioTrigger\",\"audioTrigger\":%d}",
        state.audioTrigger
    );
}

static void update_controls()
{
    hw.ProcessAllControls();

    // Pot 1 = key.
    state.key = knob_to_index(hw.GetKnobValue(DaisyPod::KNOB_1), NUM_KEYS);

    // Pot 2 = scale.
    state.scale = knob_to_index(hw.GetKnobValue(DaisyPod::KNOB_2), NUM_SCALES);

    // Encoder = brightness, matching the pre-audio browser visualizer firmware.
    int encoder_delta = hw.encoder.Increment();
    if(encoder_delta != 0)
    {
        state.brightness += encoder_delta;

        if(state.brightness < MIN_BRIGHTNESS)
            state.brightness = MIN_BRIGHTNESS;

        if(state.brightness > MAX_BRIGHTNESS)
            state.brightness = MAX_BRIGHTNESS;
    }

    // Button 1 = enabled/on/off.
    if(hw.button1.RisingEdge())
    {
        state.enabled = !state.enabled;
    }

    // Button 2 / SW2 = display mode, matching the pre-audio controller mapping.
    // It also sends a short optional audio trigger event. The browser only uses
    // this event when Voice Mode is enabled on the visualizer page.
    if(hw.button2.RisingEdge())
    {
        state.mode = (state.mode + 1) % NUM_MODES;
        state.audioTrigger++;
        print_audio_trigger_event();
    }
}

static void update_pod_leds()
{
    // LED1 = heartbeat.
    if(heartbeat)
        hw.led1.Set(1.0f, 0.0f, 0.0f);
    else
        hw.led1.Set(0.0f, 0.0f, 0.0f);

    // LED2 = status: off if disabled, otherwise mode color.
    if(!state.enabled)
    {
        hw.led2.Set(0.0f, 0.0f, 0.0f);
    }
    else if(state.mode == 0)
    {
        hw.led2.Set(0.0f, 1.0f, 0.0f); // FullScale = green.
    }
    else if(state.mode == 1)
    {
        hw.led2.Set(0.0f, 0.0f, 1.0f); // RootsOnly = blue.
    }
    else
    {
        hw.led2.Set(1.0f, 1.0f, 0.0f); // AllMapped = yellow.
    }

    hw.UpdateLeds();
}

int main(void)
{
    hw.Init();
    hw.seed.StartLog(true);
    hw.StartAdc();

    int heartbeat_tick = 0;
    int periodic_tick = 0;

    print_state();
    update_pod_leds();

    while(1)
    {
        update_controls();

        bool changed = !have_printed_state || !states_equal(state, last_printed_state);

        if(changed)
        {
            print_state();
            periodic_tick = 0;
        }

        // Repeat the current state once per second so the browser can recover
        // from missed lines or reconnects without touching a control.
        periodic_tick++;
        if(periodic_tick >= 50)
        {
            periodic_tick = 0;
            print_state();
        }

        // LED1 heartbeat every ~500 ms.
        heartbeat_tick++;
        if(heartbeat_tick >= 25)
        {
            heartbeat_tick = 0;
            heartbeat = !heartbeat;
        }

        update_pod_leds();
        hw.DelayMs(20);
    }
}
