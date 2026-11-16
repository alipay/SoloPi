package com.alipay.hulu.common.tools;

import org.junit.Test;
import static org.junit.Assert.*;

public class VirtualLaunchCommandTest {
    @Test public void formatsAResolvedComponent() {
        assertEquals("shell:am start --display 8 -n com.example.app/com.example.app.MainActivity",
                VirtualLaunchCommand.create(8, "com.example.app", "com.example.app.MainActivity"));
        // Android can declare a launch activity whose Java package differs from its application ID.
        assertEquals("shell:am start --display 8 -n com.example.app/com.example.shared.MainActivity",
                VirtualLaunchCommand.create(8, "com.example.app", "com.example.shared.MainActivity"));
    }

    @Test public void rejectsShellSyntax() {
        String[][] bad = {{"com.example.app;id", "com.example.app.Main"},
                {"com.example.app", "com.example.app.Main;id"}};
        for (String[] pair : bad) {
            try { VirtualLaunchCommand.create(8, pair[0], pair[1]); fail(); }
            catch (IllegalArgumentException expected) { }
        }
        try { VirtualLaunchCommand.create(0, "com.example.app", "com.example.app.Main"); fail(); }
        catch (IllegalArgumentException expected) { }
    }
}
