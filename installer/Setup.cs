using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class Setup
{
    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Boreas");
        bool upgrading = File.Exists(Path.Combine(root, "boreas.config.json"));
        using (var form = new Form { Text = "Boreas Setup", Width = 570, Height = 235, StartPosition = FormStartPosition.CenterScreen, FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false })
        {
            var label = new Label { Text = "Data folder", Left = 20, Top = 22, AutoSize = true };
            var folder = new TextBox { Text = Path.Combine(root, "Data"), Left = 20, Top = 47, Width = 420, ReadOnly = upgrading };
            var browse = new Button { Text = "Browse", Left = 450, Top = 45, Width = 80, Enabled = !upgrading };
            var startup = new CheckBox { Text = "Start Boreas in the tray when I sign in to Windows", Checked = true, Left = 20, Top = 87, Width = 440 };
            var install = new Button { Text = upgrading ? "Update" : "Install", Left = 450, Top = 131, Width = 80 };
            browse.Click += (sender, e) =>
            {
                using (var picker = new FolderBrowserDialog { Description = "Choose an empty folder for Boreas Data" })
                    if (picker.ShowDialog(form) == DialogResult.OK) folder.Text = picker.SelectedPath;
            };
            install.Click += (sender, e) =>
            {
                try
                {
                    if (upgrading) Upgrade(root);
                    else Install(root, folder.Text.Trim(), startup.Checked);
                    form.Close();
                }
                catch (Exception error) { MessageBox.Show(form, error.Message, "Boreas Setup", MessageBoxButtons.OK, MessageBoxIcon.Error); }
            };
            form.Controls.AddRange(new Control[] { label, folder, browse, startup, install });
            form.AcceptButton = install;
            Application.Run(form);
        }
    }

    private static void Extract(string destination)
    {
        using (var payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("Boreas.Payload"))
        using (var zip = new ZipArchive(payload, ZipArchiveMode.Read))
            zip.ExtractToDirectory(destination);
    }

    private static void Upgrade(string root)
    {
        string tray = Path.Combine(root, "BoreasTray.exe");
        foreach (var process in Process.GetProcessesByName("BoreasTray"))
        {
            using (process)
                if (process.SessionId == Process.GetCurrentProcess().SessionId)
                    throw new InvalidOperationException("Exit Boreas from its tray menu before running the update.");
        }
        string stage = root + ".update-" + Guid.NewGuid().ToString("N");
        string payload = Path.Combine(stage, "payload"), backup = Path.Combine(stage, "backup");
        var changes = new System.Collections.Generic.List<Tuple<string, string>>();
        bool stopped = false;
        try
        {
            Directory.CreateDirectory(payload);
            Extract(payload);
            using (var launcher = Process.Start(new ProcessStartInfo(
                Path.Combine(Environment.SystemDirectory, @"WindowsPowerShell\v1.0\powershell.exe"),
                "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + Path.Combine(root, "Start-Boreas.ps1") + "\" -Stop")
                { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = root }))
            {
                launcher.WaitForExit();
                if (launcher.ExitCode != 0) throw new InvalidOperationException("Boreas could not be stopped.");
            }
            stopped = true;
            foreach (var source in Directory.GetFiles(payload, "*", SearchOption.AllDirectories))
            {
                string relative = source.Substring(payload.Length + 1);
                string target = Path.Combine(root, relative), previous = Path.Combine(backup, relative);
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                if (File.Exists(target))
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(previous));
                    File.Copy(target, previous);
                    changes.Add(Tuple.Create(target, previous));
                }
                else changes.Add(Tuple.Create(target, (string)null));
                File.Copy(source, target, true);
            }
        }
        catch
        {
            for (int i = changes.Count - 1; i >= 0; i--)
            {
                if (changes[i].Item2 == null) File.Delete(changes[i].Item1);
                else File.Copy(changes[i].Item2, changes[i].Item1, true);
            }
            throw;
        }
        finally
        {
            if (Directory.Exists(stage)) Directory.Delete(stage, true);
            if (stopped) Process.Start(new ProcessStartInfo(tray) { UseShellExecute = true });
        }
    }

    private static string FindNode()
    {
        var preferred = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
        if (File.Exists(preferred)) return preferred;
        foreach (var directory in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator))
        {
            if (!Path.IsPathRooted(directory.Trim('"'))) continue;
            var candidate = Path.Combine(directory.Trim('"'), "node.exe");
            if (File.Exists(candidate)) return candidate;
        }
        throw new InvalidOperationException("Install Node.js 20 or newer, then reopen Boreas Setup.");
    }

    private static void Install(string root, string selectedData, bool startup)
    {
        if (Directory.Exists(root)) throw new InvalidOperationException("A Boreas installation already exists at " + root + ".");
        if (!Path.IsPathRooted(selectedData) || Path.GetPathRoot(selectedData).Length < 3) throw new InvalidOperationException("Choose an absolute Data folder.");
        string data = Path.GetFullPath(selectedData).TrimEnd(Path.DirectorySeparatorChar);
        string defaultData = Path.Combine(root, "Data");
        bool insideProgram = data.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
        if (String.Equals(data, Path.GetPathRoot(data).TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase) ||
            String.Equals(data, root, StringComparison.OrdinalIgnoreCase) ||
            root.StartsWith(data + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ||
            (insideProgram && !String.Equals(data, defaultData, StringComparison.OrdinalIgnoreCase)))
            throw new InvalidOperationException("Choose the default Data folder or a separate empty folder.");
        if (Directory.Exists(data) && Directory.GetFileSystemEntries(data).Length != 0)
            throw new InvalidOperationException("Choose an empty Data folder.");
        string node = FindNode();
        var stage = root + ".setup-" + Guid.NewGuid().ToString("N");
        Directory.CreateDirectory(stage);
        try
        {
            Extract(stage);
            Directory.CreateDirectory(insideProgram ? Path.Combine(stage, "Data") : data);
            var config = new { host = "0.0.0.0", port = 5180, publicOrigin = "", dataDirectory = data, nodeExecutable = node, apps = new { sports = false, liveTV = false } };
            File.WriteAllText(Path.Combine(stage, "boreas.config.json"), new JavaScriptSerializer().Serialize(config), new UTF8Encoding(false));
            Directory.Move(stage, root);
        }
        finally { if (Directory.Exists(stage)) Directory.Delete(stage, true); }
        string tray = Path.Combine(root, "BoreasTray.exe");
        using (var run = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run"))
        {
            if (startup) run.SetValue("Boreas", "\"" + tray + "\"");
            else run.DeleteValue("Boreas", false);
        }
        string menu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Boreas.url");
        File.WriteAllText(menu, "[InternetShortcut]\r\nURL=http://localhost:5180/\r\n");
        Process.Start(new ProcessStartInfo(tray, "--setup") { UseShellExecute = true });
    }
}
