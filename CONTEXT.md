# Multiplayer AI Planning Room

Shared language for the lightweight V1 collaboration product.

## Collaboration

**Room**:
A temporary shared space where participants discuss a coding requirement with a local AI coding agent.
_Avoid_: Workspace, project, channel

**Participant**:
A person who has joined a room and can read, contribute messages, and share screenshots.
_Avoid_: User account, member, host

**Agent connection**:
A participant's live connection between the room and their local Pi coding agent.
_Avoid_: Host agent, owner agent

**Active agent**:
The one connected Pi agent currently eligible to receive a room handoff. A room has at most one active agent at a time.
_Avoid_: Primary agent, room owner

**Handoff**:
An explicit batch of new room messages and attachments sent to the active agent for planning.
_Avoid_: Prompt, sync, broadcast

**Screenshot attachment**:
An image shared in a room to provide visual context for a requirement or design discussion.
_Avoid_: File upload, document
