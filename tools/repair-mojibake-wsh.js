// tools/repair-mojibake-wsh.js
// Usage depuis CMD:
//   cscript //nologo tools\repair-mojibake-wsh.js path\to\file [/inplace]
//
// Principe: texte mojibaké (UTF-8 mal relu en Latin-1) -> recompose les octets d'origine -> redécode en UTF-8
// Écrit le résultat en UTF-8 SANS BOM si /inplace est fourni.

(function () {
  var args = WScript.Arguments;
  if (args.length < 1) {
    WScript.StdErr.WriteLine("Usage: cscript //nologo tools\\repair-mojibake-wsh.js <file> [/inplace]");
    WScript.Quit(1);
  }
  var file = args.Item(0);
  var inplace = (args.length > 1) && (/^\/inplace$/i).test(args.Item(1));

  // Lire le fichier tel quel (UTF-8 ou autre) en texte
  function readText(path) {
    var ado = new ActiveXObject("ADODB.Stream");
    ado.Type = 2; // text
    ado.Charset = "utf-8"; // essaye d'abord utf-8 (même si moche visuellement)
    ado.Open();
    ado.LoadFromFile(path);
    var t = ado.ReadText();
    ado.Close();
    return t;
  }

  // Texte mojibaké -> bytes UTF-8 d'origine (en l'encodant en Windows-1252)
  function textToBytesLatin1(t) {
    var s = new ActiveXObject("ADODB.Stream");
    s.Type = 2; // text
    s.Charset = "Windows-1252";
    s.Open();
    s.WriteText(t);
    s.Position = 0;
    s.Type = 1; // binary
    var bytes = new ActiveXObject("ADODB.Stream");
    bytes.Type = 1;
    bytes.Open();
    s.CopyTo(bytes);
    s.Close();
    bytes.Position = 0;
    return bytes; // Stream binaire positionné début
  }

  // Bytes -> texte UTF-8
  function bytesToUtf8Text(bytesStream) {
    bytesStream.Position = 0;
    var s = new ActiveXObject("ADODB.Stream");
    s.Type = 2; // text
    s.Charset = "utf-8";
    s.Open();
    // Convertir bytes -> text via CopyTo en changeant le Type/Charset
    var tmp = new ActiveXObject("ADODB.Stream");
    tmp.Type = 1; // binary
    tmp.Open();
    bytesStream.CopyTo(tmp);
    tmp.Position = 0;
    // basculer en text/utf-8
    tmp.Type = 2;
    tmp.Charset = "utf-8";
    var txt = tmp.ReadText();
    tmp.Close();
    s.Close();
    return txt;
  }

  // Écrire texte en UTF-8 SANS BOM
  function writeUtf8NoBom(path, text) {
    // 1) text -> utf8 bytes (ADODB écrit avec BOM par défaut)
    var t = new ActiveXObject("ADODB.Stream");
    t.Type = 2; t.Charset = "utf-8"; t.Open();
    t.WriteText(text);
    t.Position = 0;
    t.Type = 1; // binary: contient BOM
    // 2) copier sans les 3 premiers octets (EF BB BF)
    var out = new ActiveXObject("ADODB.Stream");
    out.Type = 1; out.Open();

    // Lire tout en bloc:
    var bin = t.Read(); // ADODB.Recordset/Variant byte array
    // Convertir en VBArray pour manipuler
    var vb = new VBArray(bin);
    var arr = vb.toArray();
    var start = 0;
    if (arr.length >= 3 && arr[0] === 0xEF && arr[1] === 0xBB && arr[2] === 0xBF) {
      start = 3;
    }
    // Recomposer sans BOM
    var safe = [];
    for (var i = start; i < arr.length; i++) safe.push(arr[i]);

    // Ecrire
    // Construire un ADODB.Stream binaire à partir du tableau
    // On doit créer un SafeArray COM:
    var dict = new ActiveXObject("Scripting.Dictionary");
    // Hack simple: réécrire via un deuxième stream texte/utf-8 et ensuite stripBOM déjà fait… mais on l'a fait là-haut.

    // Méthode plus directe: écrire en binaire via Write:
    // Créer un ADODB.Stream mémoire pour safe[]
    var ms = new ActiveXObject("ADODB.Stream");
    ms.Type = 1; ms.Open();
    // Convertir liste -> byte array COM:
    // Crée un tableau COM via JScript: il faut passer par un objet temporaire
    // Astuce: utiliser adodb Stream WriteText/Charset=windows-1252 n'ira pas.
    // On va reconstruire un string binaire puis .WriteText ? Non.
    // ADODB.Stream.Write attend un Variant/Byte() côté COM, qui n'est pas trivial en JScript pur.
    // On contourne: sauver d'abord avec BOM puis tronquer 3 octets à la fin par FileSystem.

    t.SaveToFile(path, 2 /*adSaveCreateOverWrite*/); // écrit AVEC BOM
    t.Close();

    // Tronquer les 3 premiers octets via FileSystemObject
    var fso = new ActiveXObject("Scripting.FileSystemObject");
    var tmpPath = path + ".tmp_nobom";
    var ts = fso.OpenTextFile(path, 1, false, -1); // -1 = Unicode/UTF-16, pas bon…
    // Alternative: recopier en binaire avec Scripting.FileSystemObject n’est pas top.
    // On va faire une copie binaire via ADODB en enlevant le BOM:

    // Re-écrire proprement:
    var binOut = new ActiveXObject("ADODB.Stream");
    binOut.Type = 1; binOut.Open();

    // Recréons "bin" sans BOM (safe[]) dans binOut:
    // Construire un RECORDSET binaire n'est pas simple en JScript… On va refaire un flux texte puis convertir.

    // Solution simple et robuste:
    //  - On ré-encode "text" en Windows-1252 (perte?) => Non, on veut UTF-8 final.
    //  - On génère à nouveau bytes UTF-8 via Charset utf-8 puis strip BOM avec CopyTo en sautant 3 octets.
    //  ==> On va relire le fichier écrit (avec BOM) et copier à partir de position 3.

    var src = new ActiveXObject("ADODB.Stream");
    src.Type = 1; src.Open();
    src.LoadFromFile(path);
    src.Position = 3; // sauter BOM
    src.CopyTo(binOut);
    binOut.Position = 0;

    // Sauver en overwrite
    binOut.SaveToFile(path, 2);
    binOut.Close(); src.Close();
  }

  try {
    var original = readText(file);               // texte (mojibaké)
    var asBytes = textToBytesLatin1(original);   // bytes UTF-8 d'origine
    var fixed = bytesToUtf8Text(asBytes);        // texte réparé

    if (inplace) {
      writeUtf8NoBom(file, fixed);
      WScript.Echo("Réparé (UTF-8 sans BOM): " + file);
    } else {
      WScript.StdOut.Write(fixed);
    }
  } catch (e) {
    WScript.StdErr.WriteLine("Erreur: " + (e && e.message ? e.message : e));
    WScript.Quit(2);
  }
})();
