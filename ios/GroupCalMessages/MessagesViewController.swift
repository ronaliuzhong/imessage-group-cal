import Messages
import SwiftUI

/// The iMessage extension's entry point: Messages creates this when someone
/// opens Coucal in a conversation. The screens themselves are SwiftUI
/// (MessagesRootView); the logic is in ChatModel.
final class MessagesViewController: MSMessagesAppViewController {
    private let model = ChatModel()

    override func viewDidLoad() {
        super.viewDidLoad()
        model.requestStyle = { [weak self] style in
            self?.requestPresentationStyle(style)
        }
        model.insertMessage = { [weak self] message in
            guard let conversation = self?.activeConversation else { return }
            try await conversation.insert(message)
        }
        model.sendMessage = { [weak self] message in
            guard let conversation = self?.activeConversation else { return }
            try await conversation.send(message)
        }
        model.openURL = { [weak self] url in
            // Extensions can't open other apps directly; this asks Messages to.
            self?.extensionContext?.open(url)
        }

        let host = UIHostingController(rootView: MessagesRootView(model: model))
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
    }

    /// Runs each time Coucal opens in a conversation, including by tapping
    /// one of its bubbles.
    override func willBecomeActive(with conversation: MSConversation) {
        super.willBecomeActive(with: conversation)
        Task { await model.activate(in: conversation) }
    }

    /// A Coucal bubble was tapped while the extension was already open.
    override func didSelect(_ message: MSMessage, conversation: MSConversation) {
        super.didSelect(message, conversation: conversation)
        Task { await model.selected(message) }
    }
}
