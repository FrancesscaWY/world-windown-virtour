import SwiftUI
import WebKit

@main
struct VirTourApp: App {
    var body: some Scene { WindowGroup { GuideWebView().ignoresSafeArea(.container, edges: .bottom) } }
}

struct GuideWebView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(context.coordinator, name: "virtourNative")
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator; context.coordinator.webView = view
        view.load(URLRequest(url: URL(string: "tour.html?mode=companion", relativeTo: context.coordinator.base)!.absoluteURL))
        return view
    }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "virtourNative")
    }
    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        let base = URL(string: (Bundle.main.object(forInfoDictionaryKey: "GuideBaseURL") as? String ?? "https://v.direct.apricityx.top:55555") + "/")!
        weak var webView: WKWebView?
        lazy var audio = BackgroundGuide(base: base) { [weak self] event in self?.emit(event) }
        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            let origin = message.frameInfo.securityOrigin
            guard message.frameInfo.isMainFrame, origin.protocol == "https", origin.host == base.host,
                  origin.port == (base.port ?? 443), let body = message.body as? [String: Any] else { return }
            audio.command(body)
        }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { audio.sync() }
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { decisionHandler(.cancel); return }
            if url.scheme == "https", url.host == base.host, url.port == base.port { decisionHandler(.allow) }
            else { decisionHandler(.cancel); if ["https", "http"].contains(url.scheme ?? "") { UIApplication.shared.open(url) } }
        }
        func emit(_ value: [String: Any]) {
            var event = value; event["channel"] = "virtour.native"
            guard let data = try? JSONSerialization.data(withJSONObject: event),
                  let json = String(data: data, encoding: .utf8),
                  let originData = try? JSONSerialization.data(withJSONObject: base.absoluteString, options: .fragmentsAllowed),
                  let origin = String(data: originData, encoding: .utf8) else { return }
            webView?.evaluateJavaScript("window.postMessage(\(json), \(origin))")
        }
    }
}
