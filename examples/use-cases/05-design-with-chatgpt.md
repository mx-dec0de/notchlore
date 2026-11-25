# Design a better interaction with ChatGPT

Use ChatGPT as a design partner when you know what feels wrong but cannot yet specify the screen. Give it the current view, the user’s last action and the next decision they need to make. A screenshot of a “Save roadmap” dialog and the sentence “people close this thinking they have a copy” give the conversation somewhere to start.

```text
notchlore. Review this save dialog. Walk through what the user sees after Save. Show two concrete alternatives, recommend one, and ask one question only if its answer would change the design.
```

**An illustrative exchange**

> **You:** People click Save and close the tab. Some come back looking for a downloaded file.
>
> **ChatGPT:** Does Save store the roadmap in this browser, or write a file the user can take away? The label and confirmation depend on that.
>
> **You:** It stores it in the browser. Download already exists under the menu.
>
> **ChatGPT:** Keep the local save as the main action. Label it “Save in this browser,” show “Saved in this browser” after success, and put “Download a copy” next to it. The other option is to ask for a destination on every save, which adds a choice for people who always save locally.

That exchange resolves a product fact and gives you something to critique. Ask for a small text wireframe or screenshot annotation before requesting a full mockup. Judge it against a scenario: a person wants to send the roadmap to a colleague. Can they find the file action on the first screen? Can they tell which copy exists after clicking the local action?

| Moment | Agreed behavior in this example |
| --- | --- |
| First visit | Show “Save in this browser” and “Download a copy.” |
| Local save succeeds | Confirm where the roadmap was saved. |
| Local storage write fails | Keep the unsaved work visible and offer the download action. |

**Close the chat loop.** Ask ChatGPT to record the accepted labels, states, rejected alternative and one usability question for a real person. Save that decision beside the feature spec. The next coding session can verify labels and failure behavior. Whether people actually understand the distinction needs observation with users.

If the chat starts producing more options after the decision, give it a narrower next turn: “Keep the chosen design. Write the three screen states and the acceptance checks now.”

[All use cases](README.md)
