"use client";

import { useEffect, useRef, useState } from "react";

type Props = { onScan: (value: string) => void; instruction?: string; feedback?: string; active?: boolean };

export function CardScanner({ onScan, instruction, feedback, active = true }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onScanRef = useRef(onScan);
  const activeRef = useRef(active);
  const frameRef = useRef(0);
  const lastRef = useRef({ value: "", at: 0 });
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("Mac 摄像头未开启");
  const [manual, setManual] = useState("");

  useEffect(() => { onScanRef.current = onScan; }, [onScan]);
  useEffect(() => { activeRef.current = active; }, [active]);

  useEffect(() => () => { cancelAnimationFrame(frameRef.current); streamRef.current?.getTracks().forEach((track) => track.stop()); }, []);

  const stop = () => {
    cancelAnimationFrame(frameRef.current); streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setEnabled(false); setMessage("Mac 摄像头未开启");
  };

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      streamRef.current = stream; if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setEnabled(true);
      const Detector = (window as unknown as { BarcodeDetector?: new (options: { formats: string[] }) => { detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>> } }).BarcodeDetector;
      if (!Detector) { setMessage("当前浏览器不支持原生二维码识别，请用手动输入"); return; }
      const detector = new Detector({ formats: ["qr_code"] }); setMessage("正在识别卡牌二维码");
      let lastRun = 0;
      const scan = async (time: number) => {
        if (activeRef.current && time - lastRun > 240 && videoRef.current?.readyState === 4) {
          lastRun = time;
          try {
            const codes = await detector.detect(videoRef.current);
            const value = codes[0]?.rawValue;
            if (value && (lastRef.current.value !== value || Date.now() - lastRef.current.at > 2500)) {
              lastRef.current = { value, at: Date.now() }; setMessage(`已读取：${value}`); onScanRef.current(value);
            }
          } catch { setMessage("识别器暂时不可用，可使用手动输入"); }
        }
        frameRef.current = requestAnimationFrame(scan);
      };
      frameRef.current = requestAnimationFrame(scan);
    } catch { setMessage("无法打开 Mac 摄像头，请检查浏览器权限"); }
  };

  return <section className="scanner-panel">
    <div className="section-title"><span>卡牌识别</span><small>{instruction ?? "Mac 本机摄像头"}</small></div>
    <div className="scanner-view">
      <video ref={videoRef} autoPlay playsInline muted />
      {!enabled && <div className="scanner-reticle"><i /><span>QR</span></div>}
    </div>
    <div className="scanner-status"><span className={`status-dot ${enabled ? "connected" : "offline"}`} />{feedback || message}</div>
    <div className="scanner-actions">
      <button className="secondary" onClick={enabled ? stop : start}>{enabled ? "关闭摄像头" : "开启扫码"}</button>
      <div className="manual-code"><input value={manual} onChange={(event) => setManual(event.target.value)} placeholder="极昼疾行" /><button onClick={() => manual.trim() && onScanRef.current(manual.trim())}>读取</button></div>
    </div>
  </section>;
}
