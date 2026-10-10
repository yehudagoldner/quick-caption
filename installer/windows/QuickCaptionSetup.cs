using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Text.RegularExpressions;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Microsoft.Win32;

static class Setup {
    static readonly string Agent = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonProgramFiles), @"Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe");
    static readonly string LogRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Quick Caption", "Installer");
    static readonly string ReportId = Guid.NewGuid().ToString();
    static string LogPath { get { return Path.Combine(LogRoot, "last-install.json"); } }
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static readonly string[] Packages = {"QuickCaption-Timeline-Bridge-1.0.1.zxp", "QuickCaption-Premiere-1.0.1.ccx"};
    static byte[] Resource(string name) {
        using(var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name)) {
            if(stream == null) throw new InvalidDataException("missing_payload");
            using(var memory = new MemoryStream()) { stream.CopyTo(memory); return memory.ToArray(); }
        }
    }
    static void Verify() {
        var hashes = Json.Deserialize<System.Collections.Generic.Dictionary<string,string>>(Encoding.UTF8.GetString(Resource("checksums.json")));
        foreach(var name in Packages) {
            var data = Resource(name);
            string hash;
            using(var sha = SHA256.Create()) hash = BitConverter.ToString(sha.ComputeHash(data)).Replace("-", "").ToLowerInvariant();
            if(!hashes.ContainsKey(name) || hashes[name] != hash) throw new InvalidDataException("payload_checksum");
            using(var zip = new ZipArchive(new MemoryStream(data), ZipArchiveMode.Read)) {
                if(zip.Entries.Any(e => e.FullName.Split('/').Contains("..") || e.FullName.StartsWith("/") || e.FullName.Contains("bridge-config.json") || e.FullName.EndsWith(".p12"))) throw new InvalidDataException("unsafe_payload");
                if(name.EndsWith(".ccx")) {
                    var entry = zip.GetEntry("manifest.json");
                    if(entry == null) throw new InvalidDataException("missing_manifest");
                    using(var reader = new StreamReader(entry.Open())) {
                        var manifest = Json.Deserialize<System.Collections.Generic.Dictionary<string,object>>(reader.ReadToEnd());
                        if((string)manifest["id"] != "com.quickcaption.premiere.qa" || (string)manifest["version"] != "1.0.1") throw new InvalidDataException("incorrect_manifest");
                    }
                } else if(zip.GetEntry("META-INF/signatures.xml") == null || zip.GetEntry("CSXS/manifest.xml") == null) throw new InvalidDataException("missing_signature");
            }
        }
    }
    static bool PremiereRunning() { return Process.GetProcessesByName("Adobe Premiere Pro").Length > 0; }
    static string[] HostVersions() {
        var candidates = new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach(var view in new[]{RegistryView.Registry64, RegistryView.Registry32}) {
            using(var root = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, view))
            using(var key = root.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Adobe Premiere Pro.exe")) {
                var value = key == null ? null : key.GetValue("") as string;
                if(!String.IsNullOrEmpty(value)) candidates.Add(value.Trim('"'));
            }
        }
        var adobe = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Adobe");
        if(Directory.Exists(adobe)) foreach(var directory in Directory.GetDirectories(adobe, "Adobe Premiere Pro*").Take(32)) candidates.Add(Path.Combine(directory, "Adobe Premiere Pro.exe"));
        return candidates.Where(File.Exists).Select(f => FileVersionInfo.GetVersionInfo(f).FileVersion).Where(v => !String.IsNullOrEmpty(v)).ToArray();
    }
    static void Prune() {
        try { if(File.Exists(LogPath) && File.GetLastWriteTimeUtc(LogPath) < DateTime.UtcNow.AddDays(-7)) File.Delete(LogPath); } catch {}
    }
    static string BackupDevelopmentBridge() {
        var source=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"Adobe\CEP\extensions\com.quickcaption.premiere.bridge.qa");
        if(!Directory.Exists(source) || File.Exists(Path.Combine(source,@"META-INF\signatures.xml"))) return null;
        var manifest=Path.Combine(source,@"CSXS\manifest.xml");
        if(!File.Exists(manifest) || !File.ReadAllText(manifest).Contains("ExtensionBundleId=\"com.quickcaption.premiere.bridge.qa\"")) throw new InvalidDataException("unrecognized_existing_bridge");
        var backup=Path.Combine(LogRoot,"development-bridge-backup");
        if(Directory.Exists(backup)) throw new IOException("existing_backup_requires_review");
        Directory.CreateDirectory(LogRoot);
        // Both targets are fixed per-user paths, outside persistent project assets.
        Directory.Move(source,backup); return source;
    }
    static void RestoreDevelopmentBridge(string source) {
        var backup=Path.Combine(LogRoot,"development-bridge-backup");
        if(source != null && Directory.Exists(backup) && !Directory.Exists(source)) Directory.Move(backup,source);
    }
    static void Record(string stage, int? exit = null) {
        try {
            Directory.CreateDirectory(LogRoot); Prune();
            var report = new {id=ReportId, at=DateTime.UtcNow.ToString("o"), expiresAt=DateTime.UtcNow.AddDays(7).ToString("o"), stage=stage, exitCode=exit, platform="win32", installerVersion="1.0.1"};
            File.WriteAllText(LogPath, Json.Serialize(report), new UTF8Encoding(false));
        } catch { /* Logging must not prevent installation. */ }
    }
    static async Task<int> Install(string package) {
        var info = new ProcessStartInfo(Agent);
        info.UseShellExecute=false; info.CreateNoWindow=true; info.RedirectStandardOutput=true; info.RedirectStandardError=true;
        info.Arguments="/install \"" + package + "\"";
        using(var process=Process.Start(info)) {
            var output=process.StandardOutput.ReadToEndAsync(); var error=process.StandardError.ReadToEndAsync();
            await Task.Run(() => process.WaitForExit()); await Task.WhenAll(output,error);
            return AdobeResult(process.ExitCode,output.Result+"\n"+error.Result);
        }
    }
    static int AdobeResult(int exit, string output) {
        // UPIA returns process exit 0 even when its own install status is -204.
        // Never treat process exit alone as successful installation.
        var status=Regex.Match(output,@"status\s*=\s*(-?\d+)",RegexOptions.IgnoreCase);
        int code;
        if(status.Success && Int32.TryParse(status.Groups[1].Value,out code) && code!=0) return code;
        if(exit!=0) return exit;
        if(Regex.IsMatch(output,@"\bfailed\b|\bfailure\b",RegexOptions.IgnoreCase)) return -10000;
        if(Regex.IsMatch(output,@"\bsuccess(?:ful(?:ly)?)?\b",RegexOptions.IgnoreCase)) return 0;
        return -10000; // Unrecognized output: do not claim that Adobe installed it.
    }
    [STAThread] public static int Main(string[] args) {
        Prune();
        try { Verify(); } catch { if(args.Length>0) Console.WriteLine("{\"ok\":false,\"code\":\"invalid_package\"}"); else MessageBox.Show("The installer package is damaged. Download it again.","Quick Caption"); return 2; }
        if(args.Contains("--verify")) {
            if(AdobeResult(0,"Failed to install, status = -204!")!=-204 || AdobeResult(0,"Extension installed successfully")!=0 || AdobeResult(0,"Installing extension...")!=-10000 || AdobeResult(7,"Extension installed successfully")!=7) return 3;
            Console.WriteLine("{\"ok\":true,\"packages\":2,\"version\":\"1.0.1\",\"adobeStatusParser\":true}"); return 0;
        }
        if(args.Contains("--preflight")) { Console.WriteLine(Json.Serialize(new {ok=File.Exists(Agent), creativeCloud=File.Exists(Agent), premiereRunning=PremiereRunning(), hostVersions=HostVersions()})); return 0; }
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        var form = new Form {Text="Quick Caption · Premiere Setup", ClientSize=new Size(570,410), StartPosition=FormStartPosition.CenterScreen, FormBorderStyle=FormBorderStyle.FixedDialog, MaximizeBox=false, BackColor=Color.FromArgb(25,30,39), ForeColor=Color.White, Font=new Font("Segoe UI",11)};
        var title=new Label {Text="Quick Caption", Font=new Font("Segoe UI",24,FontStyle.Bold), AutoSize=true, Location=new Point(28,24)};
        var description=new Label {Text="התקנת תוסף לפרימייר\nגרסת בדיקה · QA · Premiere 25.6 ומעלה\n\nשמרו את הפרויקט וסגרו את פרימייר לפני ההתקנה.\nCreative Cloud צריך להיות מותקן ומעודכן.\nלאחר ההתקנה: Window → UXP Plugins → Quick Caption QA", Size=new Size(510,165), Location=new Point(28,85), RightToLeft=RightToLeft.Yes};
        var status=new Label {Text="מוכנים להתקנה", Location=new Point(28,266), Size=new Size(510,45), RightToLeft=RightToLeft.Yes};
        var progress=new ProgressBar {Location=new Point(28,317), Size=new Size(510,6), Visible=false, Style=ProgressBarStyle.Marquee};
        var install=new Button {Text="התקנה", Location=new Point(350,340), Size=new Size(188,44), FlatStyle=FlatStyle.Flat, BackColor=Color.FromArgb(25,115,220), ForeColor=Color.White};
        var close=new Button {Text="סגירה", Location=new Point(28,340), Size=new Size(130,44), FlatStyle=FlatStyle.Flat};
        close.Click += (s,e) => form.Close();
        bool running=false;
        form.FormClosing += (s,e) => { if(running) e.Cancel=true; };
        install.Click += async (s,e) => {
            if(!File.Exists(Agent)) { status.Text="Creative Cloud לא נמצא. התקינו או עדכנו אותו ונסו שוב."; Record("creative_cloud_missing"); return; }
            if(PremiereRunning()) { status.Text="שמרו וסגרו את פרימייר, ואז לחצו שוב על התקנה."; return; }
            running=true; install.Enabled=false; close.Enabled=false; progress.Visible=true;
            string temporary=Path.Combine(Path.GetTempPath(),"QuickCaptionSetup-"+Guid.NewGuid().ToString("N"));
            string developmentSource=null; bool completed=false;
            try {
                developmentSource=BackupDevelopmentBridge();
                Directory.CreateDirectory(temporary);
                for(int i=0;i<Packages.Length;i++) {
                    status.Text=i==0 ? "מתקין את רכיב ההצבה…" : "מתקין את התוסף…";
                    var filename=Path.Combine(temporary,Packages[i]); File.WriteAllBytes(filename,Resource(Packages[i]));
                    int exit=await Install(filename); Record(i==0?"bridge_install":"plugin_install",exit);
                    if(exit!=0) { status.Text="ההתקנה נעצרה. קוד Adobe: "+exit+"\nקוד אבחון: "+ReportId; install.Text="ניסיון נוסף"; return; }
                }
                status.Text="ההתקנה הושלמה. פתחו את פרימייר ואת Quick Caption QA.";
                install.Visible=false; Record("complete",0);
                completed=true;
            } catch { status.Text="ההתקנה נכשלה. קוד אבחון: "+ReportId; Record("installer_failure"); }
            finally { if(!completed) { try {RestoreDevelopmentBridge(developmentSource);} catch {Record("restore_failure");} } running=false; close.Enabled=true; install.Enabled=true; progress.Visible=false; try { Directory.Delete(temporary,true); } catch {} }
        };
        form.Controls.AddRange(new Control[]{title,description,status,progress,install,close});
        if(args.Length==2 && args[0]=="--preview") {
            form.CreateControl(); form.PerformLayout();
            using(var bitmap=new Bitmap(form.ClientSize.Width,form.ClientSize.Height)) {
                using(var graphics=Graphics.FromImage(bitmap)) graphics.Clear(form.BackColor);
                foreach(Control control in form.Controls) if(control != progress) {control.CreateControl(); control.DrawToBitmap(bitmap,control.Bounds);}
                bitmap.Save(args[1],System.Drawing.Imaging.ImageFormat.Png);
            }
            form.Dispose(); return 0;
        }
        Application.Run(form); return 0;
    }
}
