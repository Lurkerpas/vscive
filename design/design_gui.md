The editor shall have:
- the main canvas, which shows the diagram,
- palette, located at the left side, aligned to top,
- minimap, located at the upper right corner,
- properties panel, which showns only when an entity is selected, or options are to be shown.

The pallete shall have the following buttons:
- Zoom In,
- Zoom Out,
- Zoom to Fit,
- Snap to Grid,
- Focus,
- Add Function,
- Add Provided Interface (adds to the currently selected Function),
- Add Required Interface (adds to the currently selected Function),
- Add Connection,
- Export Diagram as Image,
- Show Options,
- Lock Diagram from Modification.

The buttons shall be illustrated using only an icon, with name shown as a tooltip on mouse hover.

Functions shall be rectangles, with a header at the top. The header shall show function name, followed by selected implementation language, between []. So for example, Function sensor, implemented in SDL, shall have the following caption: sensor [SDL]. The inside of the function, below the header, shall be reserved for showing its nested functions, if any are present.

It shall be possible to move a function by dragging it.
It shall be possible to resize a function by dragging one of its borders, or its corner.

Interfaces shall be denoted using a triangle and a small accompanying icon. Each interface shall be on the edge (any edge, movable by the user) of a function, just outside of the function. Provided Interface shall be a triangle pointing towards the center of the host function - the pointing vertex shall touch the function border. Required Interface shall point in the opposite direction, so that one of its edges shall directly touch the function border. The accompanying icon shall be located a bit to the right and botton from from triangle, and shall be:
- a circle with an arrow for cyclic interfaces,
- a symbolic lock for protected interfaces,
- a symbolic thunder for sporadic interfaces,
- an exclamation mark for unprotected interfaces.
There should be only a single point on the interface for making connections, on the outside - for provided interfaces, in the middle of the outside edge, for required interfaces, on the outside vertex.

It shall be possible to move an interface by dragging it. Its position shall be contrained to the edge of the hosting function.

Add Connection shall invoke a mode in which clicking two functions will connected them using a pair of interfaces: first function will get a required interface, the second a provided one. Clicking on canvas before selecting two functions will cancel the operation. The locations of the interfaces shall be on function borders, closest to the point of original selection clicks.

If there is an interface, sporadic, protected or unprotected, once its connection point is clicked, dragged and dropped onto another interface, they shall be connected. If the connection is dragged and dropped onto a function, not interface, a corresponding compatible interface shall be created and connected. It's location should be the closest to the drop point.

Right clicking on the canvas shall present a menu with the following options:
- Search Function,
- Add Function,
- Add Connection,
- Paste (if Function has been copied),
- Build Skeletons (invoking make skeletons in the folder of the interfaceview.xml),
- Build (invoking make in the folder of the interfaceview.xml),
- Run Debug (invoking make debug run in the folder of the interfaceview.xml),
- Run Release (invoking make release run in the folder of the interfaceview.xml),
- Export Diagram as Image.

Search Function shall open a dialog with a list of all functions in the diagram, including nested functions. The dialog shall provide a regexp filter, matched case-insensitively against the displayed function caption. Once a function is selected, the dialog shall close, that function shall become selected on the canvas, and the view shall be centered on it.

Right clicking on a function shall present a menu with the following options:
- Add Provided Interface,
- Add Required Interface,
- Copy (copying the selected function),
- Paste (if Interface has been copied),
- Add Nested Function,
- Move to Root (if a function is nested),
- Edit Function (launching editor for its source, logic to be implemented later),
- Delete Function.

Right clicking on an interface shall present a menu with the following options:
- Copy (copying the selected interface).

Right clicking on a node on a Connection shall present a menu with the following options:
- Remove Node,
- Remove Connection.

Right clicking on a Connection shall present a menu with the following options:
- Add Node,
- Remove Connection.

Copy-Paste shall copy the given entity, but wihout any connections, and assigning new UID.

Snap to Grid shall be toggleable. When on, all positions of interfaces and function borders (so it applies also to resizing), shall be aligned to the grid.
Focus shall be toggleable. When on:
- if a function is selected, only the selected function, its interfaces, the connections attached to those interfaces, and the directly connected functions and interfaces shall be visible,
- if an interface is selected, only the selected interface, its host function, the functions connected to that interface, the corresponding opposite-end interfaces, and the corresponding connections shall be visible.
Untoggling Focus shall make the entire diagram visible again.
Lock Diagram from Modification shall be toggleable. When on, all positions and sizes shall be locked.

Color picker shall allow to select a color, using:
- RGB hex color notation,
- color wheel,
- one of predefined colors (red, green, blue, cyan, magenta, yellow, grey), each in 3 variants (light, dark, normal).

When Show Options is clicked, the properties panel shall show the following settings:
- Path to the attributes file,
- Canvas color,
- Snap to Grid toggle,
- Snap grid size,
- Show minimap toggle,
- Show interface names toggle,
- Show connection labels toggle,
- Function name font size,
- Interface name font size,
- Connection name font size,
- Undo / redo depth.

When Function is selected, the properties panel shall show:
- editable typed fields for name, language, default implementation, is type, and fixed system element,
- editable visible schema-driven function attributes,
- editable Context Parameters,
- editable function properties.

Context Parameters shall be presented in a list similar to interface arguments, with editable name, type, and value fields, plus buttons to move a context parameter up or down in order, remove it, or add a new one.

When Interface is selected, the properties panel shall show:
- editable name,
- read-only type,
- editable kind,
- read-only Autonamed value,
- editable InheritPI checkbox,
- editable or inherited-and-locked arguments,
- editable visible schema-driven interface attributes,
- read-only preserved Property values.

Arguments shall be shown for both provided and required interfaces. When connected, the arguments of provided interfaces shall be editable, while the arguments of required interfaces shall be locked and inherited from the connected provided interface.
Arguments shall be presented in a grid, with columns for name, type, encoding and direction, as well as buttons to move the given argument up and down in order, as well as remove it. There should also be a button to add a new parameter.

InheritPI property shall be editable via a checkbox.

Deployment View editor shall re-use the same overall layout and interaction model as Interface View: main canvas in the center, palette on the left, minimap in the upper right, and properties panel on the right.

The palette for Deployment View shall re-use the common navigation and view commands from Interface View:
- Zoom In,
- Zoom Out,
- Zoom to Fit,
- Snap to Grid,
- Focus,
- Add Node,
- Add Connection,
- Export Diagram as Image,
- Show Options,
- Lock Diagram from Modification.

Deployment View shall not use palette actions to deploy or undeploy Functions or Messages. Deployment of Functions to Nodes and deployment of Messages to Connections shall be done in the properties panel.

Nodes shall be shown on the canvas using the same visual language as Functions in Interface View: rounded rectangles with a header and a body. The header shall show node name, followed by selected board name or type in square brackets. The body shall contain exactly one visible Partition area.

Because each Node is assumed to contain exactly one Partition, the Partition shall be rendered as a single inner panel occupying most of the Node body. The Partition shall not expose separate canvas editing gestures. Its purpose on canvas is to show deployment summary, not to manage deployment directly.

To avoid clutter when many Functions are deployed, the Partition area on canvas shall show:
- deployed function count,
- up to a small number of function names as a preview,
- an overflow indicator such as "+97 more" when additional Functions are deployed.

Devices shall be shown as small port cards attached to the inside edges of the Node, similar to how Interfaces are attached to Function edges in Interface View. Each Device card shall show device name and port name. Device cards shall expose connection handles.

It shall be possible to move a Node by dragging it.
It shall be possible to resize a Node by dragging one of its borders or corners.
It shall be possible to move Device cards along the border of the hosting Node. Their position shall stay constrained to the Node edge.

Connections shall visually re-use the Interface View connection style, including orthogonal routing, draggable waypoints, selection handles, and focus mode behavior. A Connection shall be created by dragging from one Device card to another compatible Device card, or by using Add Connection mode and then selecting source and destination Devices.

Right clicking on the canvas shall present a menu with the following options:
- Search Node,
- Add Node,
- Add Connection,
- Export Diagram as Image.

Search Node shall open a dialog with a case-insensitive filter over all Nodes. Selecting a Node shall center the canvas on it and select it.

Right clicking on a Node shall present a menu with the following options:
- Edit Node,
- Add Connection,
- Delete Node.

Right clicking on a Device shall present a menu with the following options:
- Edit Device,
- Start Connection,
- Delete Device.

Right clicking on a Connection waypoint shall present a menu with the following options:
- Remove Node,
- Remove Connection.

Right clicking on a Connection line shall present a menu with the following options:
- Add Node,
- Edit Connection,
- Remove Connection.

When Show Options is clicked, the properties panel shall show the following settings:
- Path to the boards file,
- Canvas color,
- Snap to Grid toggle,
- Snap grid size,
- Show minimap toggle,
- Show device names toggle,
- Show connection labels toggle,
- Node name font size,
- Device name font size,
- Connection name font size,
- Undo / redo depth.

When no entity is selected, the properties panel may additionally show a compact summary of all Nodes, all undeployed Functions, and all Connections, but without direct editing controls.

When a Node is selected, the properties panel shall show:
- editable text fields for node name and node label,
- read-only board type and namespace,
- editable visible preserved attributes,
- a Devices section,
- a Partition Functions section.

The Devices section shall present all Devices belonging to the selected Node in a list or grid. Each row shall expose editable text fields for name, port, requires bus access, packetizer, config, asn1file, asn1module, asn1type, extends, impl_extends, namespace and bus_namespace.

The Partition Functions section shall be the primary mechanism for deploying and undeploying Functions. It shall use a searchable, virtualized two-state list optimized for large projects.

The Partition Functions section shall provide:
- a case-insensitive text filter,
- optional regexp filter,
- sorting by function name and deployment status,
- a "show only deployed", "show only undeployed" and "show all" toggle,
- keyboard navigation,
- multi-selection,
- one-click Deploy, Undeploy and Move actions.

Each Function row in the Partition Functions section shall show:
- function name,
- path,
- current deployment status,
- current Node assignment if deployed,
- an action button.

If a Function is already deployed to another Node, the row shall clearly show the existing assignment and shall not allow duplicate deployment. Deploying such a Function to the selected Node shall be presented as a Move operation, replacing the previous assignment so that every Function remains deployed to at most one Partition.

The default sort order in the Partition Functions section shall place exact filter matches first, then undeployed Functions, then deployed Functions. This is to make finding and deploying a single Function fast even when there are hundreds of Functions.

When a Device is selected, the properties panel shall show editable text fields for all Device attributes, plus a read-only indication of the owning Node and board.

When a Connection is selected, the properties panel shall show:
- editable connection name,
- read-only source Node and Device,
- read-only destination Node and Device,
- editable to_bus text field,
- editable visible preserved attributes,
- a Messages section.

The Messages section shall be the primary mechanism for deploying and undeploying Messages on the selected Connection. It shall use the same scalable interaction pattern as Partition Functions: searchable, virtualized, keyboard-friendly, and optimized for large lists.

The Messages section shall provide:
- a case-insensitive text filter matching message name, source function, source interface, destination function and destination interface,
- optional regexp filter,
- sorting by message name and deployment status on the selected Connection,
- "show only deployed", "show only undeployed" and "show all" toggles,
- multi-selection,
- one-click Deploy and Undeploy actions.

Each Message row shall show:
- message name,
- source function and interface,
- destination function and interface,
- deployment status on the selected Connection.

Deploying a Message from the properties panel shall create or update the corresponding Message element under the currently selected Connection. Undeploying it shall remove that Message element from the selected Connection.

The canvas representation of a selected Connection shall show a compact message summary, such as message count and the first few message names, while the full editable message list shall remain in the properties panel.

When a new Node is created, a dialog shall be shown with a searchable board picker populated from the configured boards file. The dialog shall support case-insensitive filtering by board name, type and namespace. Selecting a board shall create the Node with its board-defined type, namespace and initial Devices.

If a Deployment View file contains Nodes, Devices or attributes that are not present in the currently configured boards file, they shall still be rendered and editable. Such Nodes may be marked as using an unknown board definition, but saving the file shall preserve all loaded values.

Focus mode shall work analogously to Interface View:
- if a Node is selected, only that Node, its Devices and attached Connections shall remain visible,
- if a Device is selected, only the owning Node, the selected Device and connected Devices and Connections shall remain visible,
- if a Connection is selected, only the connection and its endpoint Nodes and Devices shall remain visible.


