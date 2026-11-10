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
    private static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        if (args.Length == 2 && (args[0] == "--install-program" || args[0] == "--update-program"))
        {
            try { if (args[0] == "--update-program") CopyUpgrade(ValidateProgram(args[1])); else InstallProgram(ValidateProgram(args[1])); }
            catch (Exception error) { MessageBox.Show(error.Message, "Boreas Setup"); Environment.ExitCode = 1; }
            return;
        }
        string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Boreas");
        string data = Path.Combine(RuntimeDirectory(), "Data");
        using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Boreas"))
            if (key != null) root = (string)key.GetValue("ProgramFolder", root);
        string legacy = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Boreas");
        if (File.Exists(Path.Combine(legacy, "boreas.config.json")) && !Directory.Exists(root)) root = legacy;
        using (var form = new Form { Text = "Boreas Setup", Width = 570, Height = 345, StartPosition = FormStartPosition.CenterScreen, FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, Icon = System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath) })
        using (var logoStream = Assembly.GetExecutingAssembly().GetManifestResourceStream("Boreas.Logo"))
        using (var logo = System.Drawing.Image.FromStream(logoStream))
        {
            var picture = new PictureBox { Image = logo, SizeMode = PictureBoxSizeMode.Zoom, Left = 20, Top = 12, Width = 56, Height = 56 };
            var title = new Label { Text = "Boreas Setup", Left = 88, Top = 29, AutoSize = true, Font = new System.Drawing.Font("Segoe UI", 15, System.Drawing.FontStyle.Bold) };
            var programLabel = new Label { Text = "Program folder", Left = 20, Top = 82, AutoSize = true };
            var program = new TextBox { Text = root, Left = 20, Top = 105, Width = 420 };
            var programBrowse = new Button { Text = "Browse", Left = 450, Top = 103, Width = 80 };
            var label = new Label { Text = "Data folder", Left = 20, Top = 143, AutoSize = true };
            var folder = new TextBox { Text = data, Left = 20, Top = 166, Width = 420 };
            var browse = new Button { Text = "Browse", Left = 450, Top = 164, Width = 80 };
            var startup = new CheckBox { Text = "Start Boreas in the tray when I sign in to Windows", Checked = true, Left = 20, Top = 210, Width = 440 };
            var install = new Button { Text = "Install", Left = 450, Top = 245, Width = 80 };
            Action refresh = () => {
                bool upgrading = IsInstalled(program.Text.Trim());
                install.Text = upgrading ? "Update" : "Install";
                folder.ReadOnly = upgrading;
                browse.Enabled = startup.Enabled = !upgrading;
            };
            program.TextChanged += (sender, e) => refresh();
            refresh();
            programBrowse.Click += (sender, e) => PickFolder(form, program, "Choose where to install Boreas");
            browse.Click += (sender, e) => PickFolder(form, folder, "Choose an empty folder for Boreas Data");
            install.Click += (sender, e) =>
            {
                try
                {
                    string destination = ValidateProgram(program.Text.Trim());
                    if (IsInstalled(destination)) Upgrade(destination);
                    else Install(destination, folder.Text.Trim(), startup.Checked);
                    form.Close();
                }
                catch (Exception error) { MessageBox.Show(form, error.Message, "Boreas Setup", MessageBoxButtons.OK, MessageBoxIcon.Error); }
            };
            form.Controls.AddRange(new Control[] { picture, title, programLabel, program, programBrowse, label, folder, browse, startup, install });
            form.AcceptButton = install;
            Application.Run(form);
        }
    }

    private static string RuntimeDirectory() { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Boreas"); }
    private static bool IsInstalled(string root)
    {
        return File.Exists(Path.Combine(root, "BoreasTray.exe")) &&
            (File.Exists(Path.Combine(root, "boreas-installed")) || File.Exists(Path.Combine(root, "boreas.config.json")));
    }

    private static string ValidateProgram(string root)
    {
        if (String.IsNullOrWhiteSpace(root) || !Path.IsPathRooted(root)) throw new InvalidOperationException("Choose an absolute Program folder.");
        root = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
        if (root.Length <= 3 || root.Equals(RuntimeDirectory(), StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Choose a dedicated Program folder.");
        return root;
    }

    private static void PickFolder(Form form, TextBox input, string description)
    {
        using (var picker = new FolderBrowserDialog { Description = description })
            if (picker.ShowDialog(form) == DialogResult.OK) input.Text = picker.SelectedPath;
    }

    private static void InstallProgram(string root)
    {
        if (Directory.Exists(root)) throw new InvalidOperationException("Choose a new Program folder.");
        string stage = root + ".setup-" + Guid.NewGuid().ToString("N");
        Directory.CreateDirectory(stage);
        try
        {
            Extract(stage);
            File.WriteAllText(Path.Combine(stage, "boreas-installed"), "");
            Directory.Move(stage, root);
        }
        finally { if (Directory.Exists(stage)) Directory.Delete(stage, true); }
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
        bool stopped = false;
        try
        {
            using (var launcher = Process.Start(new ProcessStartInfo(
                Path.Combine(Environment.SystemDirectory, @"WindowsPowerShell\v1.0\powershell.exe"),
                "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + Path.Combine(root, "Start-Boreas.ps1") + "\" -Stop")
                { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = root }))
            {
                launcher.WaitForExit();
                if (launcher.ExitCode != 0) throw new InvalidOperationException("Boreas could not be stopped.");
            }
            stopped = true;
            if (File.Exists(Path.Combine(root, "boreas-installed")))
            {
                using (var elevated = Process.Start(new ProcessStartInfo(Application.ExecutablePath, "--update-program \"" + root + "\"") { UseShellExecute = true, Verb = "runas" }))
                {
                    elevated.WaitForExit();
                    if (elevated.ExitCode != 0) throw new InvalidOperationException("Boreas could not be updated.");
                }
            }
            else CopyUpgrade(root);
        }
        finally { if (stopped) Process.Start(new ProcessStartInfo(tray) { UseShellExecute = true }); }
    }

    private static void CopyUpgrade(string root)
    {
        if (!IsInstalled(root)) throw new InvalidOperationException("Choose an existing Boreas installation.");
        string stage = root + ".update-" + Guid.NewGuid().ToString("N");
        string payload = Path.Combine(stage, "payload"), backup = Path.Combine(stage, "backup");
        var changes = new System.Collections.Generic.List<Tuple<string, string>>();
        try
        {
            Directory.CreateDirectory(payload);
            Extract(payload);
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
        if (insideProgram) throw new InvalidOperationException("Choose a Data folder outside the Program folder.");
        string runtime = RuntimeDirectory();
        if (File.Exists(Path.Combine(runtime, "boreas.config.json"))) throw new InvalidOperationException("A Boreas installation already exists for this Windows account.");
        Directory.CreateDirectory(data);
        Directory.CreateDirectory(runtime);
        try { InstallProgram(root); }
        catch (UnauthorizedAccessException)
        {
            using (var elevated = Process.Start(new ProcessStartInfo(Application.ExecutablePath, "--install-program \"" + root + "\"") { UseShellExecute = true, Verb = "runas" }))
            {
                elevated.WaitForExit();
                if (elevated.ExitCode != 0) throw new InvalidOperationException("The Program folder could not be installed.");
            }
        }
        var config = new { host = "0.0.0.0", port = 5180, publicOrigin = "", dataDirectory = data, nodeExecutable = node, apps = new { sports = false, liveTV = false } };
        File.WriteAllText(Path.Combine(runtime, "boreas.config.json"), new JavaScriptSerializer().Serialize(config), new UTF8Encoding(false));
        using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Boreas")) key.SetValue("ProgramFolder", root);
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
