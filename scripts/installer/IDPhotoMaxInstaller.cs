using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Windows.Forms;

[assembly: AssemblyTitle("IDPhoto MAX Setup")]
[assembly: AssemblyProduct("IDPhoto MAX")]
[assembly: AssemblyVersion("0.5.0.0")]
[assembly: AssemblyFileVersion("0.5.0.0")]

internal static class IDPhotoMaxInstaller
{
    private const string PayloadResourceName = "IDPhotoMax.Payload.zip";

    [STAThread]
    private static int Main(string[] args)
    {
        bool dryRun = Array.Exists(
            args,
            delegate(string value)
            {
                return string.Equals(value, "--dry-run", StringComparison.OrdinalIgnoreCase);
            });
        string tempRoot = Path.Combine(
            Path.GetTempPath(),
            "IDPhotoMAX-Setup-" + Guid.NewGuid().ToString("N"));

        try
        {
            Directory.CreateDirectory(tempRoot);
            string zipPath = Path.Combine(tempRoot, "payload.zip");
            string packageRoot = Path.Combine(tempRoot, "package");

            using (Stream payload = Assembly.GetExecutingAssembly().GetManifestResourceStream(PayloadResourceName))
            {
                if (payload == null)
                {
                    throw new InvalidOperationException("The embedded plugin package is missing.");
                }

                using (FileStream output = File.Create(zipPath))
                {
                    payload.CopyTo(output);
                }
            }

            Directory.CreateDirectory(packageRoot);
            ZipFile.ExtractToDirectory(zipPath, packageRoot);

            string installerScript = Path.Combine(packageRoot, "install-plugin.ps1");
            if (!File.Exists(installerScript))
            {
                throw new InvalidOperationException("The embedded installer script is missing.");
            }

            string arguments = "-NoProfile -ExecutionPolicy Bypass -File " +
                Quote(installerScript) + " -PackageRoot " + Quote(packageRoot);
            if (dryRun)
            {
                arguments += " -DryRun";
            }

            ProcessStartInfo startInfo = new ProcessStartInfo("powershell.exe", arguments);
            startInfo.UseShellExecute = false;
            startInfo.CreateNoWindow = true;
            startInfo.RedirectStandardOutput = true;
            startInfo.RedirectStandardError = true;
            startInfo.WorkingDirectory = packageRoot;

            using (Process process = new Process())
            {
                StringBuilder details = new StringBuilder();
                process.StartInfo = startInfo;
                DataReceivedEventHandler collect = delegate(object sender, DataReceivedEventArgs line)
                {
                    if (line.Data != null) { lock (details) { details.AppendLine(line.Data); } }
                };
                process.OutputDataReceived += collect;
                process.ErrorDataReceived += collect;
                if (!process.Start())
                {
                    throw new InvalidOperationException("PowerShell could not be started.");
                }

                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                process.WaitForExit();
                if (process.ExitCode != 0)
                {
                    if (!dryRun)
                    {
                        MessageBox.Show(
                            "Installation stopped:\n" + details.ToString(),
                            "IDPhoto MAX Setup",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Error);
                    }
                    return process.ExitCode;
                }
            }

            if (!dryRun)
            {
                MessageBox.Show(
                    "IDPhoto MAX was installed. Restart Photoshop, then open it from the Plugins menu.",
                    "IDPhoto MAX Setup",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            }
            return 0;
        }
        catch (Exception exception)
        {
            if (!dryRun)
            {
                MessageBox.Show(
                    "Installation failed: " + exception.Message,
                    "IDPhoto MAX Setup",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
            return 1;
        }
        finally
        {
            try
            {
                if (Directory.Exists(tempRoot))
                {
                    Directory.Delete(tempRoot, true);
                }
            }
            catch
            {
                // A locked temporary file can be removed by Windows later.
            }
        }
    }

    private static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }
}
