/**
 * On-device checks of how `NitroInput` hands the system keyboard around: from
 * one field to the next, across a native-stack push and pop, and away when
 * nothing takes it. Each test records every keyboard event, so a dip - the
 * keyboard dropping and rising again between two fields - shows up as a
 * `keyboardWillHide` where there should be none, not something to eyeball.
 * The events come from React Native's own `Keyboard` module: keyboard-controller
 * pulls Reanimated worklets in when it is imported, which Harness's test
 * bundles cannot load under Worklets Bundle Mode. Android sends only the `Did`
 * events, so a hide is either kind.
 *
 * They need a software keyboard: run them on a phone
 * (`test:harness:ios-device` / `:android-device`). A simulator with the Mac's
 * keyboard connected never shows one; there every test returns early once the
 * first one has found no keyboard.
 */
import React, { createRef, useEffect, useState } from 'react';
import { Keyboard, Platform, View } from 'react-native';
import { describe, expect, it } from 'react-native-harness';
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { NitroInput, type NitroInputHandle } from 'react-native-nitro-input';
import { render, sleep, waitFor } from './test-utils';

type KeyboardEvent = { type: string; at: number; height: number };

/** Every keyboard event from now on. */
function keyboardRecorder() {
  const events: KeyboardEvent[] = [];
  const subscriptions = (
    [
      'keyboardWillShow',
      'keyboardDidShow',
      'keyboardWillHide',
      'keyboardDidHide',
    ] as const
  ).map(type =>
    Keyboard.addListener(type, e =>
      events.push({
        type,
        at: Date.now(),
        height: type.endsWith('Hide') ? 0 : e.endCoordinates.height,
      }),
    ),
  );
  return {
    events,
    hidesSince: (at: number) =>
      events.filter(
        e =>
          e.at >= at &&
          (e.type === 'keyboardWillHide' || e.type === 'keyboardDidHide'),
      ),
    /** The lowest height any keyboard event reported since `at` (a hide reports 0). */
    lowestSince: (at: number) =>
      Math.min(
        ...events.filter(e => e.at >= at).map(e => e.height),
        Number.POSITIVE_INFINITY,
      ),
    stop: () => subscriptions.forEach(s => s.remove()),
  };
}

let noKeyboard = false;

/** Focuses `field` and waits for the keyboard; false when none shows (a simulator with the Mac's keyboard). */
async function openKeyboard(field: NitroInputHandle | null): Promise<boolean> {
  if (noKeyboard) return false;
  field?.focus();
  try {
    await waitFor(() => expect(Keyboard.isVisible()).toBe(true), 4000);
  } catch {
    noKeyboard = true;
    console.warn(
      '[keyboard suite] no software keyboard showed; skipping the keyboard tests on this device',
    );
    return false;
  }
  // Let the show animation finish so the frames that follow are the test's.
  await sleep(700);
  return true;
}

async function closeKeyboard() {
  Keyboard.dismiss();
  await waitFor(() => expect(Keyboard.isVisible()).toBe(false), 4000).catch(
    () => {},
  );
  await sleep(300);
}

describe('NitroInput keyboard handoff', () => {
  it('keeps the keyboard up when focus moves to another field', async () => {
    const first = createRef<NitroInputHandle>();
    const second = createRef<NitroInputHandle>();
    const log = keyboardRecorder();
    await render(
      <View style={{ gap: 12, padding: 20 }}>
        <NitroInput ref={first} defaultValue="first" />
        <NitroInput ref={second} defaultValue="second" />
      </View>,
    );
    try {
      if (!(await openKeyboard(first.current))) return;
      const open = Keyboard.metrics()?.height ?? 0;
      const from = Date.now();
      // What a "next" button does after onSubmitEditing with submitBehavior="submit".
      second.current!.focus();
      await sleep(900);
      expect(log.hidesSince(from)).toEqual([]);
      expect(log.lowestSince(from)).toBeGreaterThanOrEqual(open - 1);
    } finally {
      log.stop();
      await closeKeyboard();
    }
  });

  it('keeps the keyboard up when a focused field unmounts as the next one autofocuses', async () => {
    const first = createRef<NitroInputHandle>();
    const log = keyboardRecorder();
    let swap = () => {};
    function Swapper() {
      const [step, setStep] = useState(0);
      swap = () => setStep(1);
      return step === 0 ? (
        <NitroInput
          key="a"
          ref={first}
          defaultValue="step one"
          keyboardHandoffMs={400}
        />
      ) : (
        <NitroInput key="b" autoFocus defaultValue="step two" />
      );
    }
    await render(
      <View style={{ padding: 20 }}>
        <Swapper />
      </View>,
    );
    try {
      if (!(await openKeyboard(first.current))) return;
      const open = Keyboard.metrics()?.height ?? 0;
      const from = Date.now();
      swap();
      await sleep(900);
      expect(log.hidesSince(from)).toEqual([]);
      expect(log.lowestSince(from)).toBeGreaterThanOrEqual(open - 1);
    } finally {
      log.stop();
      await closeKeyboard();
    }
  });

  // The case `keyboardHandoffMs` exists for: popping a screen whose field has
  // the keyboard, back to a screen that refocuses its own field once it is
  // focused again - as an app's "refocus on return" hook does.
  // Android keeps the IME up either way once the returning field's focus()
  // waits for its view to be back on the window; iOS drops it without the
  // handoff, the control that shows the test measures something.
  for (const handoffMs of [400, 0]) {
    const keeps = handoffMs > 0 || Platform.OS === 'android';
    it(`${
      keeps ? 'keeps' : 'drops'
    } the keyboard across a stack pop (keyboardHandoffMs=${handoffMs})`, async () => {
      const Stack = createNativeStackNavigator();
      const navigation =
        createNavigationContainerRef<Record<string, undefined>>();
      const home = createRef<NitroInputHandle>();
      const log = keyboardRecorder();

      function Home({
        navigation: nav,
      }: {
        navigation: { addListener: (e: 'focus', cb: () => void) => () => void };
      }) {
        useEffect(
          () =>
            nav.addListener('focus', () => {
              if (Keyboard.isVisible()) home.current?.focus();
            }),
          [nav],
        );
        return (
          <NitroInput
            ref={home}
            defaultValue="home"
            keyboardHandoffMs={handoffMs}
            style={{ margin: 20 }}
          />
        );
      }
      function Next() {
        return (
          <NitroInput
            autoFocus
            defaultValue="next"
            keyboardHandoffMs={handoffMs}
            style={{ margin: 20 }}
          />
        );
      }

      await render(
        <View style={{ flex: 1, height: 500 }}>
          <NavigationContainer ref={navigation}>
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              <Stack.Screen name="home" component={Home} />
              <Stack.Screen name="next" component={Next} />
            </Stack.Navigator>
          </NavigationContainer>
        </View>,
      );
      try {
        await waitFor(() => expect(home.current).not.toBeNull());
        if (!(await openKeyboard(home.current))) return;
        navigation.navigate('next');
        await sleep(1200);
        const open = Keyboard.metrics()?.height ?? 0;
        const from = Date.now();
        navigation.goBack();
        await sleep(1500);
        if (keeps) {
          expect(log.hidesSince(from)).toEqual([]);
          expect(log.lowestSince(from)).toBeGreaterThanOrEqual(open - 1);
          expect(Keyboard.isVisible()).toBe(true);
        } else {
          // Closed by the time the screen is focused again, it stays down.
          expect(log.lowestSince(from)).toBeLessThan(open / 2);
        }
      } finally {
        log.stop();
        await closeKeyboard();
      }
    });
  }

  it('lets Keyboard.dismiss() end a hold at once', async () => {
    const field = createRef<NitroInputHandle>();
    const log = keyboardRecorder();
    let unmount = () => {};
    function Host() {
      const [shown, setShown] = useState(true);
      unmount = () => setShown(false);
      return (
        <>
          {shown ? (
            <NitroInput
              ref={field}
              defaultValue="leaving"
              keyboardHandoffMs={3000}
            />
          ) : null}
          <NitroInput defaultValue="staying" />
        </>
      );
    }
    await render(
      <View style={{ gap: 12, padding: 20 }}>
        <Host />
      </View>,
    );
    try {
      if (!(await openKeyboard(field.current))) return;
      unmount();
      await sleep(200);
      const from = Date.now();
      Keyboard.dismiss();
      await waitFor(
        () => expect(log.hidesSince(from).length).toBeGreaterThan(0),
        3000,
      );
      expect(log.hidesSince(from)[0]!.at - from).toBeLessThan(500);
    } finally {
      log.stop();
      await closeKeyboard();
    }
  });

  it('lets the keyboard go once keyboardHandoffMs runs out and no field has taken it', async () => {
    const field = createRef<NitroInputHandle>();
    const log = keyboardRecorder();
    let unmount = () => {};
    function Host() {
      const [shown, setShown] = useState(true);
      unmount = () => setShown(false);
      return shown ? (
        <NitroInput ref={field} defaultValue="alone" keyboardHandoffMs={300} />
      ) : null;
    }
    await render(
      <View style={{ padding: 20 }}>
        <Host />
      </View>,
    );
    try {
      if (!(await openKeyboard(field.current))) return;
      const from = Date.now();
      unmount();
      await waitFor(
        () => expect(log.hidesSince(from).length).toBeGreaterThan(0),
        3000,
      );
      const hid = log.hidesSince(from)[0]!.at - from;
      // Not at once (the hold), and not much later than the hold either.
      expect(hid).toBeGreaterThanOrEqual(250);
      expect(hid).toBeLessThan(1000);
      await waitFor(() => expect(Keyboard.isVisible()).toBe(false), 3000);
    } finally {
      log.stop();
      await closeKeyboard();
    }
  });
});
