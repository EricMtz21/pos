// Apertura del cajón de dinero. El cajón no se conecta a la computadora: cuelga de la
// impresora de tickets por un cable RJ11, y se abre cuando la impresora recibe el pulso
// ESC/POS `ESC p m t1 t2`. Por eso esto no imprime nada: manda cinco bytes crudos.
import { spawn } from 'node:child_process'
import { writeFile, unlink } from 'node:fs/promises'
import { app } from 'electron'
import { join } from 'node:path'

// m = 0 → patilla 2 del conector, m = 1 → patilla 5. Cuál de las dos usa el cajón
// depende del fabricante; por eso es un ajuste y no una constante.
// t1/t2 son la duración del pulso en unidades de 2 ms: 50 y 250 ms, valores seguros.
const pulso = (pin) => Buffer.from([0x1b, 0x70, pin === 1 ? 0x01 : 0x00, 0x19, 0xfa])

const ES_PUERTO = /^(COM|LPT)\d+$/i

// Windows no deja mandar bytes crudos a una impresora instalada desde Node: el spooler
// los pasaría por el driver y los convertiría en una página. Hay que hablar con winspool
// declarando el trabajo como RAW, y la vía disponible sin compilar nada es P/Invoke.
const SCRIPT_RAW = `param([string]$Impresora, [string]$Archivo)
$ErrorActionPreference = 'Stop'
Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class CajonPOS {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool OpenPrinter(string nombre, out IntPtr h, IntPtr pd);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool StartDocPrinter(IntPtr h, int nivel, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool WritePrinter(IntPtr h, IntPtr datos, int n, out int escritos);

  static void Fallo(string que) { throw new Exception(que + " (error " + Marshal.GetLastWin32Error() + ")"); }

  public static void Enviar(string impresora, byte[] bytes) {
    IntPtr h;
    if (!OpenPrinter(impresora, out h, IntPtr.Zero)) Fallo("no se pudo abrir la impresora");
    try {
      DOCINFO di = new DOCINFO();
      di.pDocName = "Cajon"; di.pDataType = "RAW";
      if (!StartDocPrinter(h, 1, di)) Fallo("la impresora no acepto el trabajo");
      try {
        StartPagePrinter(h);
        IntPtr buffer = Marshal.AllocCoTaskMem(bytes.Length);
        try {
          Marshal.Copy(bytes, 0, buffer, bytes.Length);
          int escritos;
          if (!WritePrinter(h, buffer, bytes.Length, out escritos)) Fallo("no se pudieron enviar los bytes");
        } finally { Marshal.FreeCoTaskMem(buffer); }
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
'@
[CajonPOS]::Enviar($Impresora, [IO.File]::ReadAllBytes($Archivo))`

function correrPowerShell(args) {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args], {
      windowsHide: true
    })
    let error = ''
    ps.stderr.on('data', (d) => (error += d))
    ps.on('error', (err) => reject(err))
    ps.on('close', (code) => {
      if (code === 0) return resolve()
      // PowerShell escupe el error en varias líneas con la traza; la primera basta.
      reject(new Error(error.trim().split('\n')[0] || `PowerShell terminó con código ${code}`))
    })
  })
}

/**
 * Manda el pulso al cajón.
 * @param target  nombre de una impresora instalada, o un puerto directo (COM1, LPT1)
 * @param pin     0 (patilla 2) o 1 (patilla 5)
 */
export async function openDrawer({ target, pin = 0 } = {}) {
  if (!target) throw new Error('No hay impresora ni puerto configurado para el cajón')
  const bytes = pulso(pin)

  // Una impresora conectada por serie o paralelo es un archivo del sistema: se le escribe
  // directo, sin spooler y sin PowerShell de por medio.
  if (ES_PUERTO.test(target)) {
    try {
      await writeFile(`\\.\${target.toUpperCase()}`, bytes)
      return true
    } catch (err) {
      throw new Error(`No se pudo escribir en ${target.toUpperCase()}: ${err.message}`)
    }
  }

  if (process.platform !== 'win32') throw new Error('La apertura por impresora instalada solo está implementada en Windows')

  const carpeta = app.getPath('temp')
  const datos = join(carpeta, `pos-cajon-${Date.now()}.bin`)
  const script = join(carpeta, `pos-cajon-${Date.now()}.ps1`)
  try {
    await writeFile(datos, bytes)
    await writeFile(script, SCRIPT_RAW, 'utf8')
    await correrPowerShell(['-File', script, '-Impresora', target, '-Archivo', datos])
    return true
  } catch (err) {
    throw new Error(`No se pudo abrir el cajón en «${target}»: ${err.message}`)
  } finally {
    await Promise.all([unlink(datos).catch(() => {}), unlink(script).catch(() => {})])
  }
}
