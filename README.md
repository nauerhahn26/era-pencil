# era-pencil

The Pencil: an eye-gaze writing surface with an alphabet ring, always-reserved
prediction slots (server n-gram + on-device phonetic/invented-spelling layer),
letter echo, and TD-Snap-style delete/clear semantics. Part of the New ERA
Communications family; runs as a module of era-hub on era-core engines.

License: MPL-2.0.

The hub Settings page provides an independent Alternative Pencil dwell time
(`pencilDwellMs`, default 1500 ms, range 600–3000 ms), loaded when the Pencil
opens. Partner dwell buttons also save this setting for future sessions. Exit
and talk doors hold twice the current Pencil dwell. Predictions keep their
existing 2000 ms hold.

## App locks

The shared door bar now offers an independent app lock using era-core’s
controller and adult passcode UI. Locking stops activity, preserves work and
keeps exit and communication doors available. The hub’s app-lock plan records validation and release status.
