# run-petri-async
A simple Petri Net class for modeling sequencing.

# Node Module providing Classes

run-petri-async is a node.js module that exports two classes, *RunPetri*, and *pNode*. 

A third, class, pTransition, is not exported. It is sufficiently abstract that it might not be subclassed.

So, the list of classes implemented is the following:

* RunPetri
* pNode
* pTransition

And, the exported classes are:

* RunPetri
* pNode

Changes of behavior from the default are to be made by subclassing: *pNode*.
The way pNode may be subclassed will be discussed later.


Much of what follows is repeated from Run-Petri.

But, there are definite difference between Run-Petri and Run-Petri-Asycn.


    What differs from run-petri is the absence of a step method.

    All action moves foward based on the cascade of states and the readiness of transitions.
    Confusions will be handled by cloning tokens that then follow splits into downstream transitions.
    Hence the forwarding of the resource is treated as a broadcast.

    In node.js this split forwarding is done simply by emiting an event, which is sent to all listeners.
    So, during initialization the event listener lists are established by processing the configuration,
    which includes the net definition.


    Capturing the state of the petri net for display becomes a little more difficult, since a simple report of the net
    state won't be able to be seen. Events will go by too quickly for the messages to be sent to browsers for state displays.
    So, a State Trace Sink, may be introduced. The sink waits for events from the Petri nodes (places).
    The Trace Sink looks for a "place-trace" event, which has the as parameters the id of the state, 
    the value updating the place, and the time in UNIX epoch milliseconds.




The pNode class provides a default Petri Net behavior, keeping track of a token count. And, the token count is updated when a transition is triggered. The transition merely moves input node resources (decrements the token count of input nodes) to a reduction in the output nodes (increments the token count of output nodes). 

The class, RunPetri, is the class that takes in the net definition, a JSON object, so that the network model may be stored and used. The class RunPetri exposes methods for adding in resources. running transitions, and finally executing pNode methods on nodes that deliver outputs to applications. 

Every time the 'step' method of RunPetri is called, RunPetri objects will examine each transition element to see if it has enough inputs to fire. If it does, the transition methods will reduce the input resources and transition the result of the reduction to the output nodes. (The default behavior for reduction is to AND the inputs and use the result to increment the outputs.)

The application program may require the module. The requirement statement will produce an object exposing the class definitions. For example: 
```
var PetriClasses = require('run-petri');
var RunPetri = PetriClasses.RunPetri
var pNode = PetriClasses.pNode;
```

The application program creates a new instance of the RunPetri class. Then it passes a net definition object to a RunPetri method on the instance, *setNetworkFromJson*

```
var pNet = new RunPetri();
var net_def = <any way of defining the JSON object.>
pNet.setNetworkFromJson(net_def)
```

The JSON object referenced by net_def in the example above has an array of nodes definitions and an array of transitions.

Once the nodes and transitions are compiled by the RunPetri instance, the nodes (circels in Petri net diagrams) may receive values.

When all the inputs nodes of a transition contain values, the Petri net may perform actions that move the values forward through reductions. Transitions that have all of their inputs containing values, are called "active" transitions. 

It is up to the application program to trigger the execution of the active transitions. At any time, the application may call pNet.step(), and drive the values forward. 

When the appliation calls pNet.step(), *step* examines all transitions for activation and then calls upon the reduction methods of the transition move the values. 


The RunPetri class is defined with a way for the application program to pass values into it asynchronoulsy. The JSON object may contain definitions of nodes that will be called *sources*. The RunPetri instance compiles event handlers for events named with the ids of the source nodes. In this way, processes that take in data asynchronously may emit values to the source nodes, creating new resources that may flow throught the net. For example, if a source node is named, "sensor1", the applcation may call, pNet.emit("sensor1",value).


# The JSON Definition Object


Here is an example of a JSON definition object for RunPeti:

```
{
	"nodes" : [
			{ "id" : "L-sensor-1", "type" : "source" },
			{ "id" : "Pump1", "type" : "exit" },
			{ "id" : "mixer2", "type" : "exit" }
	],

	"transitions" : [
				{
					 "label" : "pump when ready",
					 "inputs" : [ "L-sensor-1" ],
					 "outputs" : [ "Pump1", "mixer2" ]
				}
	]
}

```

In the example, you can see an array of "_nodes_" and an array of "_transitions_".

Each _node_ has an _id_ field and a _type_ field. If the type is not specified, it will be assumed to be "internal". If a node represents a subclass, the node definition should contain an additional _class_ field with a value being the name of a pNode subclass defined by the application.

_Source_ nodes automatically have event identifiers made out of them for use in node.js. _Exit_ nodes are used to release values. Each exit node recieves a reference to a value consuming callback function. It is up to the application to implement the most useful verions of this.


# A Command Line Example

A basic cli application for the run-petri model can be found in the module directory. The JavaScript code is "tryout.js".

You should be able to run it: **node tryout.js**

You will see in the code that there is a switch statement. By looking at the cases, you will see that the program accepts four basic comamnds: load, send. 

- Use ```load <filename>``` to load the PetriNet description.
- Use ```send <node-name>``` to put some number of tokens into a node.

For example load our example Petr net, p2.json.

Then, 
* send L-sensor-1 3

So, there is no report in this. But, there is a hook allowing states to emit traces events.

When application calls the *setTraceSink* method of the RunPetri instance, it expects an event listener that has an implementation of the **place-trace** event. The parameters of the event are the id of the place (state/node), the value that causes the place to be marked, and the timestamp of the event.

The object has no other requirements and may be implemented to suit tha application. 

 
# Creating Subclasses of the pNode Class.

One reason to create subclasses of the pNode class is to make nodes with resources that are more descriptive than a simple count. The Petri Net with just counting is a good tool for synchornization. But, along with the synchronization, some computation may take place at the nodes and transitions. Defining this computation opens up the Petri Net structure for defining general computation, and pay be useful for sending final values downstream to other computational units or robotic mechanisms.

Depending on the kind of reduction needed, the application may need to define a special reducer to use at the transitions. Instead of requiring a subclass of transitions to be made by the application, the specialized transformation is defined by the method of specifying an anonymous function. The defualt pTransition reducer is defined as follows.

```
	this.reducer = (accumulator, currentValue) => accumulator + currentValue; // default
	this.initAccumulator = 0;  /// default
```

This accumulator with the default pNode behavior is a simple adder which will always be passed a value of one for the currentValue. In fact, this transition function would not have to be overridden if the application just wants to accumulate floating point values or concatinate strings. But, the application might want to pass arrays or objects along its path, or even a mixture of these things.

When the application calls ```setNetworkFromJson(net_def,cbGen,nodeClasses)```, it may pass several parameters that define the behavior the network. 

The first parameter has already been described above. But, there are a few more fields (features) that may be added into the description. 
The second parameter is a function that takes in arguments that tell the function how to return a particular function for use in pNode or pTransitions. The third parameter is a table of class names for the descendants of pNode classes.

The cbGen function is defined by the application. It take two parameters. 
The first parameter is a the name of a node or key identifying a transition reducer. 
The second parameter is a string indicating what kind of function cbGen should return. 
Currently, the only node type that is being assign a callback is an 'exit' node. 

```cbGen(<node name>,"exit")``` should return a callback that takes in a value, the result of reductions, such that the value will be processed or emitted to downstream processes or hardware. 

```cbGen(<reducer name>,"reduce")```  should return a function that takes in expected pNode outputs, the results of the _consume_ method, a pNode method, flowing into a transition, where the transition will call its reducer on each of the pNode outputs.

It is up to the application to make define the _reduce_ and _exit_ functions properly.

The following update of the network defined previously shows specification of a reducer on a particular transition.

```
{
	"nodes" : [
			{ "id" : "L-sensor-1", "type" : "source" },
			{ "id" : "Pump1", "type" : "exit" },
			{ "id" : "mixer2", "type" : "exit" }
	],

	"transitions" : [
				{
					 "label" : "pump when ready",
					 "inputs" : [ "L-sensor-1" ],
					 "outputs" : [ "Pump1", "mixer2" ],
					 "reduction" : {
						"reducer" : "valueArray"
						"initAccumulator" : []
					}
				}
	]
}

```

When a reducer is defined, it expects certain types of outputs from nodes. The default pNode class has a _consume_ method that returns 1 and a count function that returns its token count. So, this basic class does not have the mechanism to produce computed output. And, the application will have to derive a class from it and override a small number of methods.

In fact, it has to override the following methods:

* count
* addResource(value)
* consume


Here is how these methods are defined in the basic pNode class:

```
    count() {
        return(this.resource)
    }

    addResource(value) {
        this.resource += parseInt(value);  // default is to add how many
    }

    consume() {
        this.resource -= 1;
        return(1);
    }

```

Now, to override them, the application can extend the pNode class as follows:


```

class queueValues extends pNode {
    //
    constructor(id,nodeType) {
        super(id,nodeType)

        this.arrayResQueue = [];
    }

    count() {
        return(this.arrayResQueue.length)
    }

    addResource(value) {
        this.arrayResQueue.push(value)
    }

    consume() {
        var v = this.arrayResQueue.shift();
        return(v);
    }

}



class passStructs extends pNode {
    //
    constructor(id,nodeType) {
        super(id,nodeType)

        this.structResource = {};
    }

    count() {
        var n = Object.keys(this.structResource).length;
        return(n)
    }

    addResource(value) {
        var key = value.key;
        var data = value.value;
        this.structResource[key] = data;
    }

    consume() {
        return(this.structResource);
    }

}


const nodeClasses = { pNode, queueValues, passStructs };



```

Because these pNode classes will release values in their special ways, it helps to change the reducer for transitions. So, here is the function that returns functions for nodes and transitions to call.

```

function callbackGenerator(id,cbType) {

    if ( cbType === 'exit' ) {  // a fairly generic exit callback
        var dataExitCb = (v) => { console.log("EMIT: " + nodeId + ": " + v) }
        return(dataExitCb)
    } else if ( cbType === 'reduce' ) {  // this is the default reducer...
        var reducer = (accumulator, currentValue) => {
            accumulator.push(currentValue);
        }
        return(reducer);
    }

    return((v) => { console.log(v); return(0); })
}


```

Now the JSON has more information in it so that these classes can be used. (This json is in p2.json and the code is in tryout-subclass.js)


```

{
	"nodes" : [
			   { "id" : "L-sensor-1", "type" : "source", "class" : "queueValues" },
			   { "id" : "L-sensor-2", "type" : "source", "class" : "passStructs" },
			   { "id" : "Pump1", "type" : "exit" },
			   { "id" : "mixer2", "type" : "exit" }
	],
	"transitions" : [
				{
					 "label" : "pump when ready",
					 "inputs" : [ "L-sensor-1", "L-sensor-2" ],
					 "outputs" : [ "Pump1", "mixer2" ],
					 "reduction" : {
						"reducer" : "valueArray"
						"initAccumulator" : []
					}

				}
	]
}

```





