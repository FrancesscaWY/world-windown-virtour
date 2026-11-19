import Foundation
import AVFoundation
import CoreLocation
import MediaPlayer
import UIKit

/// Audio and location belong to iOS, not a hidden WKWebView timer.
final class BackgroundGuide: NSObject, AVAudioPlayerDelegate, CLLocationManagerDelegate {
    struct Stop: Decodable {
        let id: String, name: String, text: String
        let latitude: Double, longitude: Double
    }
    private let base: URL, emit: ([String: Any]) -> Void
    private let location = CLLocationManager()
    private var player: AVAudioPlayer?
    private var task: Task<Void, Never>?
    private var stops: [Stop] = [], audio: [String: Data] = [:], visited: Set<String> = []
    private var conversation = "", mode = "sequence", state = "stopped", current: Stop?
    private var recordID: String?
    private var records: [[String: Any]] = []
    private var paused = false
    private var version = 0
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
    init(base: URL, emit: @escaping ([String: Any]) -> Void) {
        self.base = base; self.emit = emit
        super.init()
        location.delegate = self; location.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        location.distanceFilter = 10; location.pausesLocationUpdatesAutomatically = false
        location.allowsBackgroundLocationUpdates = true; location.showsBackgroundLocationIndicator = true
        records = UserDefaults.standard.array(forKey: "virtour.native.records") as? [[String: Any]] ?? []
        // A previous process cannot still own a player after an application restart.
        records = records.map { row in
            var value = row
            if value["status"] as? String == "playing" { value["status"] = "interrupted" }
            return value
        }
        UserDefaults.standard.set(records, forKey: "virtour.native.records")
        NotificationCenter.default.addObserver(self, selector: #selector(audioInterruption), name: AVAudioSession.interruptionNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(routeChanged), name: AVAudioSession.routeChangeNotification, object: nil)
        let remote = MPRemoteCommandCenter.shared()
        remote.pauseCommand.addTarget { [weak self] _ in DispatchQueue.main.async { self?.pause() }; return .success }
        remote.playCommand.addTarget { [weak self] _ in DispatchQueue.main.async { self?.resume() }; return .success }
        remote.stopCommand.addTarget { [weak self] _ in DispatchQueue.main.async { self?.stop() }; return .success }
    }
    func command(_ body: [String: Any]) {
        switch body["command"] as? String {
        case "start":
            guard let id = body["conversationId"] as? String, id.count < 128,
                  let raw = body["items"], let data = try? JSONSerialization.data(withJSONObject: raw),
                  let items = try? JSONDecoder().decode([Stop].self, from: data), !items.isEmpty, items.count <= 12,
                  items.allSatisfy({ $0.text.count <= 1200 && !$0.text.isEmpty && abs($0.latitude) <= 90 && abs($0.longitude) <= 180 }) else { return }
            stop(); conversation = id; mode = body["mode"] as? String == "location" ? "location" : "sequence"
            let token = version
            stops = items; visited = []; audio = [:]; update("preparing")
            backgroundTask = UIApplication.shared.beginBackgroundTask { [weak self] in
                self?.task?.cancel(); self?.endBackgroundTask(); self?.update("error")
            }
            task = Task { [weak self] in
                guard let self else { return }
                do {
                    for item in items {
                        let wav = try await self.download(item.text)
                        try Task.checkCancellation()
                        await MainActor.run {
                            guard self.version == token else { return }
                            self.audio[item.id] = wav
                        }
                    }
                    await MainActor.run {
                        guard self.version == token else { return }
                        self.endBackgroundTask()
                        if self.mode == "location" { self.enableLocation() }
                        else if let first = items.first { self.play(first) }
                    }
                } catch {
                    await MainActor.run {
                        guard self.version == token else { return }
                        self.endBackgroundTask(); if !Task.isCancelled { self.update("error") }
                    }
                }
            }
        case "pause": pause()
        case "resume": resume()
        case "stop": stop()
        case "sync": sync()
        default: break
        }
    }
    private func endBackgroundTask() {
        if backgroundTask != .invalid { UIApplication.shared.endBackgroundTask(backgroundTask); backgroundTask = .invalid }
    }
    private func download(_ text: String) async throws -> Data {
        var request = URLRequest(url: base.appendingPathComponent("api/tts"))
        request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["text": text]); request.timeoutInterval = 120
        let session = URLSession(configuration: .ephemeral, delegate: NoRedirect(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let (bytes, response) = try await session.bytes(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        var pcm = Data(), size = 0, complete = false
        for try await line in bytes.lines {
            try Task.checkCancellation(); size += line.utf8.count
            guard size < 12 * 1024 * 1024, let data = line.data(using: .utf8),
                  let event = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw URLError(.cannotParseResponse) }
            if event["type"] as? String == "error" { throw URLError(.badServerResponse) }
            if event["type"] as? String == "answer" { complete = true }
            if event["type"] as? String == "audio_delta" {
                guard event["sampleRate"] as? Int == 24000, let encoded = event["audio"] as? String,
                      let chunk = Data(base64Encoded: encoded), chunk.count % 2 == 0 else { throw URLError(.cannotDecodeContentData) }
                pcm.append(chunk)
            }
        }
        guard complete, !pcm.isEmpty, pcm.count <= 24000 * 2 * 120 else { throw URLError(.zeroByteResource) }
        return Self.wav(pcm)
    }
    private static func wav(_ pcm: Data) -> Data {
        var data = Data("RIFF".utf8)
        func u32(_ value: UInt32) { var v = value.littleEndian; withUnsafeBytes(of: &v) { data.append(contentsOf: $0) } }
        func u16(_ value: UInt16) { var v = value.littleEndian; withUnsafeBytes(of: &v) { data.append(contentsOf: $0) } }
        u32(UInt32(pcm.count + 36)); data.append(Data("WAVEfmt ".utf8)); u32(16); u16(1); u16(1)
        u32(24000); u32(48000); u16(2); u16(16); data.append(Data("data".utf8)); u32(UInt32(pcm.count)); data.append(pcm)
        return data
    }
    private func play(_ item: Stop) {
        guard !paused, let data = audio[item.id], player?.isPlaying != true else { return }
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
            try AVAudioSession.sharedInstance().setActive(true)
            let next = try AVAudioPlayer(data: data); next.delegate = self
            current = item; player = next; next.prepareToPlay()
            guard next.play() else { throw URLError(.cannotDecodeContentData) }
            visited.insert(item.id); recordID = UUID().uuidString
            records.append(["id": recordID!, "conversationId": conversation, "poiId": item.id, "status": "playing", "createdAt": Date().timeIntervalSince1970 * 1000])
            saveRecords(); update("playing")
            MPNowPlayingInfoCenter.default().nowPlayingInfo = [MPMediaItemPropertyTitle: item.name, MPMediaItemPropertyArtist: "世界之窗 · 数字导游", MPMediaItemPropertyPlaybackDuration: next.duration, MPNowPlayingInfoPropertyPlaybackRate: 1.0]
        } catch { update("error") }
    }
    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        finishRecord(flag ? "finished" : "interrupted"); current = nil; self.player = nil
        if mode == "sequence", let next = stops.first(where: { !visited.contains($0.id) }) {
            if audio[next.id] != nil { play(next) } else { update("preparing") }
        } else { update(mode == "sequence" ? "finished" : "waiting") }
    }
    private func finishRecord(_ status: String) {
        if let id = recordID, let index = records.firstIndex(where: { $0["id"] as? String == id }) { records[index]["status"] = status }
        recordID = nil; saveRecords()
    }
    private func saveRecords() {
        records = Array(records.suffix(100)); UserDefaults.standard.set(records, forKey: "virtour.native.records")
        emit(["type": "records", "records": records])
    }
    private func update(_ next: String) { state = next; emit(["type": "state", "state": next, "conversationId": conversation]) }
    func sync() { saveRecords(); update(state) }
    private func enableLocation() {
        if location.authorizationStatus == .notDetermined { location.requestWhenInUseAuthorization() }
        else if location.authorizationStatus == .authorizedWhenInUse { location.requestAlwaysAuthorization() }
        else if location.authorizationStatus == .authorizedAlways { location.startUpdatingLocation(); update("waiting") }
        else { update("error") }
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard mode == "location", state != "stopped" else { return }
        if manager.authorizationStatus == .authorizedAlways { manager.startUpdatingLocation(); update("waiting") }
        else if manager.authorizationStatus == .authorizedWhenInUse { manager.requestAlwaysAuthorization(); manager.startUpdatingLocation(); update("waiting") }
        else if [.denied, .restricted].contains(manager.authorizationStatus) { update("error") }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard !paused, let point = locations.last, point.horizontalAccuracy >= 0, point.horizontalAccuracy <= 65,
              abs(point.timestamp.timeIntervalSinceNow) < 30 else { return }
        emit(["type": "position", "conversationId": conversation, "latitude": point.coordinate.latitude, "longitude": point.coordinate.longitude, "accuracy": point.horizontalAccuracy])
        guard player?.isPlaying != true else { return }
        let nearest = stops.filter { !visited.contains($0.id) && audio[$0.id] != nil }.map { item in
            (item, point.distance(from: CLLocation(latitude: item.latitude, longitude: item.longitude)))
        }.min { $0.1 < $1.1 }
        if let (item, distance) = nearest, distance <= 35 { play(item) }
    }
    func pause() { paused = true; player?.pause(); location.stopUpdatingLocation(); update("paused") }
    func resume() {
        paused = false
        do { try AVAudioSession.sharedInstance().setActive(true) } catch { update("error"); return }
        if mode == "location" { enableLocation() }
        if let player { player.play(); update("playing") }
        else if mode == "sequence", let next = stops.first(where: { !visited.contains($0.id) }) { play(next) }
        else { enableLocation() }
    }
    func stop() {
        version += 1
        task?.cancel(); task = nil; endBackgroundTask(); player?.stop(); player = nil
        finishRecord("interrupted"); current = nil; paused = false; location.stopUpdatingLocation()
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil; update("stopped")
    }
    @objc private func audioInterruption(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
        pause() // Calls/alarms never trigger an unrequested restart.
    }
    @objc private func routeChanged(_ note: Notification) {
        if note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue { pause() }
    }
}

private final class NoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
