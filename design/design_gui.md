The editor shall have:
- the main canvas, which shows the diagram,
- palette, located at the left side, aligned to top,
- minimap, located at the upper right corner,
- properties panel, which showns only when an entity is selected, or options are to be shown.

The pallete shall have the following buttons:
- Zoom In,
- Zoom Out,
- Zoom to Fit,
- Show Options,
- Add Function,
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

Right clicking on the canvas shall present a menu with the following options:
- Add Function,
- Build Skeletons (invoking make skeletons in the folder of the interfaceview.xml),
- Build (invoking make in the folder of the interfaceview.xml).

Right clicking on a function shall present a menu with the following options:
- Add Provided Interface,
- Add Required Interface,
- Edit Function (launching editor for its source, logic to be implemented later),
- Delete Function.

Clicking Control and dragging from one function to another shall created a pair of connected Required and Provided Interfaces, as described in the requirements.