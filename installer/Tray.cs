using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Windows.Forms;

internal static class Tray
{
    [STAThread]
    private static void Main(string[] args)
    {
        bool first;
        using (var instance = new System.Threading.Mutex(true, "Local\\BoreasTray", out first))
        {
            if (!first) return;
            Application.EnableVisualStyles();
            string root = AppDomain.CurrentDomain.BaseDirectory;
            const string address = "http://localhost:5180/";
            string launcher = Path.Combine(root, "Start-Boreas.ps1");
            Action<bool> run = stop => Process.Start(new ProcessStartInfo(
                Path.Combine(Environment.SystemDirectory, @"WindowsPowerShell\v1.0\powershell.exe"),
                "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + launcher + "\"" + (stop ? " -Stop" : ""))
            { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = root });
            Action open = () => Process.Start(new ProcessStartInfo(address) { UseShellExecute = true });
            var menu = new ContextMenuStrip();
            using (var icon = new NotifyIcon { Icon = System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath), Text = "Boreas", ContextMenuStrip = menu, Visible = true })
            using (var startup = new Timer { Interval = 750 })
            {
                menu.Items.Add("Open Boreas", null, (sender, e) => open());
                menu.Items.Add("Start server", null, (sender, e) => run(false));
                menu.Items.Add("Stop server", null, (sender, e) => run(true));
                menu.Items.Add("Exit tray", null, (sender, e) => Application.ExitThread());
                icon.DoubleClick += (sender, e) => open();
                run(false);
                if (Array.IndexOf(args, "--setup") >= 0)
                {
                    int tries = 0;
                    startup.Tick += (sender, e) =>
                    {
                        try
                        {
                            using (var client = new WebClient())
                                if (!client.DownloadString(address + "api/status").Contains("\"application\":\"lumen-native\"")) throw new InvalidOperationException();
                            startup.Stop();
                            open();
                        }
                        catch
                        {
                            if (++tries < 30) return;
                            startup.Stop();
                            icon.ShowBalloonTip(6000, "Boreas", "The server did not start. Check the installation's work/logs folder.", ToolTipIcon.Warning);
                        }
                    };
                    startup.Start();
                }
                Application.Run();
            }
        }
    }
}
