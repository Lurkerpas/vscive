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
- Show Options,
- Add Function,
- Add Connection,
- Export Diagram as Image,
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
- Add Function,
- Add Connection,
- Paste (if Function has been copied),
- Build Skeletons (invoking make skeletons in the folder of the interfaceview.xml),
- Build (invoking make in the folder of the interfaceview.xml),
- Export Diagram as Image.

Right clicking on a function shall present a menu with the following options:
- Add Provided Interface,
- Add Required Interface,
- Copy (copying the selected function),
- Paste (if Interface has been copied),
- Add Nested Function,
- Edit Function (launching editor for its source, logic to be implemented later),
- Delete Function.

Right clicking on an interface shall present a menu with the following options:
- Copy (copying the selected interface).

Copy-Paste shall copy the given entity, but wihout any connections, and assigning new UID.

Snap to Grid shall be toggleable. When on, all positions of interfaces and function borders (so it applies also to resizing), shall be aligned to the grid.
Lock Diagram from Modification shall be toggleable. When on, all positions and sizes shall be locked.

Color picker shall allow to select a color, using:
- RGB hex color notation,
- color wheel,
- one of predefined colors (red, green, blue, cyan, magenta, yellow, grey), each in 3 variants (light, dark, normal).

When Show Options is clicked, the properties panel shall show the following settings:
- Path to the attributes file,
- Canvas color,
- Snap grid size,
- Function name font size,
- Interface name font size,
- Connection name font size.

When Function is selected, the properties panel shall show, and allow to edit, all function properties, as well as its color.

When Interface is selected, the properties panel shall show, and allow to edit, all interface properties, as well as its color, and arguments.
Arguments shall be shown for both provided and required interfaces, however, when connected, the arguments of provided interfaces shall be editable, while the arguments of required interfaces shall be locked and inherited from the connected provided interface.
Arguments shall be presented in a grid, with columns for name, type, encoding and direction, as well as buttons to move the given argument up and down in order, as well as remove it. There should also be a button to add a new parameter.

InheritPI property shall be editable via a checkbox.


