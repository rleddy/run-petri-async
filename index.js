
const EventEmitter = require('events');


/*
  run-petri-async

    This module is similar to run-petri : https://github.com/rleddy/run-petri

    What differs from run-petri is the absence of a step method.

    All action moves foward based on the cascade of states and the readiness of transitions.
    Confusions will be handled by cloning tokens that then follow splits into downstream transitions.
    Hence the forwarding of the resource is treated as a broadcast.

    In node.js this split forwarding is done simply by emiting an event, which is sent to all listeners.
    So, during initialization the event listener lists are established by processing the configuration,
    which includes the net definition.


    Capturing the state of the petri net for display becomes a little more difficult, since a simple report of the net
    state won't be able to be seen. Events will go by too quickly for the messages to be sent to browsers for state displays.
    So, a State Trace Sink, may be introduced. The sink waits for events associated with the Petri nodes (places).

    In this implementation of a Petri net with asynchronous forwarding, the actual state is known by the transition.
    The transition store the state of places that figure into its activation. And, the transition is a good position to repor
    on the states that will be able to accept resource markers. So, the trasitions object is given the taks of emiting
    repors that may be used to render or record the progress of a the Petri net.

    The Trace Sink looks for two kinds of "place-trace" events, which have the as parameters the ids of the states, the values updating the places,
    and the time in UNIX epoch milliseconds.  There are two kinds of "place-trace" events.
    1) place-trace-pre
    2) place-trace-post

    The first event reports the state of places as soon as a transition is ready to fire. The transition will decide that it is active
    when its set of pre-nodes match with the set of markers transitions from them. It is required that all the pre-mode markers match in
    terms of presence and excitation or absence and inhibition.

    The second event is a report of post-nodes that receive resource markers from the transition.


    //----- ----- ----- ----- ----- ----- ----- ----- ----- ----- -----

    This index is the entire code of the run-petri model.

    Three classes are defined and two of them are exposed to the node.js requirment system.

    the three classes are
    1) pNode - the Petri net node. These are usually seen as circles in the diagrams - the operate as resource holders
    2) pTransition - the Petri net transition - These are the active parts of the net, usually seen as vertical lines in the diagrams.
    3) RunPetri - the is the manager of the net. This takes in the net definition object, and operates when the 'step' method is called.

    The classes that are exposed are 1) pNode and 2) RunPetri.
    The pNode class is exposed in order to allow for derived classes for applications needing more than counts.
    The RunPetri class is not expressly intended for override, although it is possible. RunPetri works with a
    general notion of a pNode class or descendenat as do the transition objects.
    So, customization may be best done just working with the pNode class.

    The RunPetri processing expects that there will be three identifiable kinds of pNodes on any level of specialization.
    The node types, indicated by a type field, are 1) input nodes, 2) internal nodes, and 3) output nodes.

    Applications specifying instances of these kinds of nodes provide a means for transitions to identify them as upstream and downstreams
    nodes that the transitions can move resources from and to. Input nodes, have no upstream transitions, and outpus are terminals to the
    directed acyclic flow.

    Applications can provide callback functions to the output nodes in order to handle emitting values, data, or simple event triggers.
    The pNodes do not have to be overriden in order to determine an output operations. A callback should be provided.

    In the case where tokens moving through the net have scalar values or have structure, the pNode can be overridden to keep track of the
    values. A recommendation: move references in small objects that are treated as resources.

*/


function clonify(obj) {
    if ( typeof obj === "object" ) {
        let cv = JSON.parse(JSON.toString(obj))
        return(cv);
    } else {
        return(obj)
    }
}






// pNode - Basic pNode behavior.
//
// The pNode is mostly an accessed object.
// A pNode virtually contains a token when it has a resource or resources.
//
// In the basic case, a pNode has a resource if it has a count of tokens.
//
//  The following methods would be overridden to specialize pNode behavior.
//
//  reportObject
//  count
//  addResource
//  consume
//
//  The pNode method forward, is call when a transition moves resources from the pNode on to another.
//  The transition calls 'consume' on one pNode and then calls forward for downstream pNodes with a value constructed from
//  the results of reducing the consumed resources. (This is a very localised version of map-reduce.
//
//  If a pNode has a contraint checking method (determined by descendant classes) the contraint check will have to be passed
//  before 'forward' can operate.  After this check, the type of the pNode will be important.
//  If the pNode is an output and there is an exit node callback, the callback will be called.
//  Otherwise, the resource value is added be a call to addResource.
//
//  ------ ------  ------ ------




class pNode extends EventEmitter {

    // nodeType - source, exit, internal
    //

    constructor(id,nodeType,target)  {

        super();

        this.id = id;
        this.type = nodeType;
        if ( this.type === undefined ) {
            this.type = "internal"
        }

        this.contraints = undefined;  // descendents may
        this.exitCallBack = undefined;

        this.inhibits = false;
        if ( nodeType == "inhibit" ) {
            this.inhibits = target;
        }

        this.resource = 0;  // default is a count

        this.transitions = [];

    }

    // if the trace sink is set, it will be used to tell a log manager
    // that it has been visited at a particular point in time.

    identity() {
        return(this.id)
    }

    hasResource(label) {
        let marked = (this.count() > 0);
        if ( this.inhibits ) {
            if ( this.inhibits == label ) return(!marked)
        }
        return(marked);
    }


    forward(value) {

        let v = clonify(value);         // if the value is a sum of inputs, this will be overkill (useful when object are in transit)

        if ( this.contraints !== undefined ) {              // The values is coming from a transition (after reduction)
            // This exposes contraints on forwarding to the JSON definition. By restricting override to the node, 
            // this allows for transitions values to be filtered as if they were on the transition. 
            // (check other version for customizing this behavior on the transition)
            if ( !(this.contraints(v)) ) return(false)      //
        }

        if ( this.type === "exit" ) {           // An exit node will work on emiting values to networks or hardware.
            if ( this.exitCallBack ) {
                this.exitCallBack(v);
            }
        } else {        // (peculiar to async -- private -- call the descendant methods from within this call)
            this.#_addResource(v);      // If not sending the value away, then store it on the node -- use events to forward
        }

        return(true);
    }


    // Nodes of type "exit" - these are terminals of the DAG.
    // see above forward(value)
    // the cb method is a consumer of "value". cb does not return a result
    setExitCB(cb) {
        this.exitCallBack = cb;
    }


    // addTransition
    // Peculiar to the async version.
    // Adding a resource to a node means that value will be stored locally
    // and will be emitted to downstream transitions.
    addTransition(trans) {
        this.transitions.push(trans);
    }

    #_addResource(v) {
        this.addResource(v)         // application defined storage (accumulation)
        this.transitions.forEach( t => {
            t.emit(this.id, v, this, this.resource);        // Emit to transitions listening to this node
        })
    }

    // overrides start here....

    reportObject() {
        return([this.id,this.resource])
    }

    // count
    // In the default case, the resource stored the number of tokens at a node
    count() {
        return(this.resource)
    }

    // addResource
    //      -- Descendants may override this method in order to utilize 
    //      -- their own storage module for value.
    //      -- this is then called by the private _add_resource methods which emits values to transitions.
    addResource(value) {
        this.resource += parseInt(value);  // default is to add how many transitions updated this node
    }

    consume() {
        this.resource -= 1;
        return(1);
    }

    clear() {
        this.resource = 0;
    }

}


// EXPORT pNode
module.exports.pNode = pNode;


//                                          TRANSITIONS
//
// pTransition -
//
//


class pTransition extends EventEmitter {

    constructor(label)  {

        super()
        //
        this.preNodes = [];
        this.postNodes = [];
        this.nodeLookup = {};

        // as places become active, this object is populated with their
        // quantities or value objects.
        this.nodeEnableCheck = {};

        // During definition, a custom value check may be added to a transition
        this.customValueChecking = {}

        this.resourceGroup = [];
        //
        this.label = label;

        this.reducer = (accumulator, currentValue) => accumulator + currentValue; // default
        this.initAccumulator = 0;  /// default
        this.forwardValue = 0; // default;

        this.#_has_transition_filters = false

        this.traceSink = null;

    }

    clear() {
        //
        this.nodeEnableCheck = {};
    }

    setTraceSink(sink) {
        this.traceSink = sink;
    }

    addPostNode(pnode) {
        //
        if ( this.nodeLookup[pnode.identity()] == undefined ) {
            this.nodeLookup[pnode.identity()] = pnode;
            //
            this.postNodes.push(pnode);
        } else {
            throw new Exception("Adding node to post transition twice.")
        }
    }


    addCustomValueChecking(nid,checker) {
        if ( typeof checker === "function" ) {
            this.#_has_transition_filters = true
            this.customValueChecking[nid] = checker
        }
    }


    custom_checking(value,node,qty) {
        let checker = this.customValueChecking[node.identity()]
        if ( checker !== undefined ) {
            return(checker(value,qty))
        }
        return true
    }


    // determines that transition conditions have been met.
    matchInputs() {
        // examine nodeEnableCheck   --- notice that preNodes are being reviewed
        let active = this.preNodes.every( pn => {
                                 return(this.nodeEnableCheck[pn.identity()] !== undefined);
                            } );
        return(active)
    }

    // set up the handler for accepting place activated events.
    // called by addPreNode

    listenToNode(nid) {
        this.on(nid,(value,node,qty) => {  // always a pre-node emits to the current transition
                    if ( this.#_has_transition_filters ) {
                        if ( !this.custom_checking(value,node,qty) ) return
                    }
                    let v = node.consume(qty);
                    this.nodeEnableCheck[node.identity()] = v;

                    if ( this.matchInputs() ) {  // Then check to see if all nodes for transistion are accounted for.

                        if ( this.traceSink ) {  // tell application which places are supplying resources.
                            this.traceSink.emit("place-trace-pre",this.label,this.nodeEnableCheck,Date.now());
                        }

                        // GO THROUGH A REDUCTION PROCESS - take the collected resources and reduce them.
                        this.consume_preNode_resources();

                        this.clear();           // clear out accumulated inputs 

                        if ( this.traceSink ) {
                            let postPlaceIds = this.postNodes.map(nn => { return( nn.id ); });
                            this.traceSink.emit("place-trace-post",this.label,postPlaceIds,Date.now());
                        }

                        // NOW OUTPUT - emit the reduction of resources performed by this transition.
                        this.output_resource_to_postNodes();
                    }
                });
    }


    addPreNode(pnode) {
        //
        if ( this.nodeLookup[pnode.identity()] == undefined ) {
            this.nodeLookup[pnode.identity()] = pnode;
            //
            this.preNodes.push(pnode);
            pnode.addTransition(this);

            this.listenToNode(pnode.identity());
        } else {
            throw new Exception("Adding node to post transition twice.")
        }
    }

    // The transition will be invoked only if it is enabled.
    // it is enabled if all prenodes have at least one resource and do not
    // inhibit this node.
    all_preNodes_active() {
        let all_ready = this.preNodes.every(pnode => {
                                                return(pnode.hasResource(this.label));
                                            })
        return(all_ready);
    }


    // traces happen here...
    //
    // consume_preNode_resources
    // step 1:  (Note the difference from sync version) Build a list of values from nodes that enabled the transition
    //          The enablements come about by the transition listening to the node.
    //          The 'nodeEnableCheck' object maps keys to the values returned by each node's 'consume' method.
    // step 2:  Reduce the array using either default initialization and reduction,
    //          or use the custom initializer and reducer set by 'setSpecialReduction' 
    //          which is specified in the network's JSON input
    consume_preNode_resources() {
        this.resourceGroup = Object.keys(this.nodeEnableCheck).map( key => { return(this.nodeEnableCheck[key]); } );
        this.forwardValue = this.resourceGroup.reduce(this.reducer,this.initAccumulator);  // the array reduce..
    }


    // output_resource_to_postNodes
    // For each node that takes input from this transition, 
    //  take the value to be forwarded, forwardValue, which was computed in 'consume_preNode_resources'
    //  and emit the value to the given node on a 'transition' event.
    output_resource_to_postNodes() {
        this.postNodes.forEach(pnode => {
                                   pnode.emit("transition",this.forwardValue);  // emit transition even bearing the reduction, 'forwardValue'
                               });
    }

    setSpecialReduction(reducer,initAccumulator) {
        this.reducer = reducer; // default
        this.initAccumulator = initAccumulator;  /// default
    }

}





// RunPetri
//
//  This is the operation container for a single Petr net instance.

// EXPORT RunPetri
module.exports.RunPetri = class RunPetri extends EventEmitter {

    constructor() {

        super();

        this.nodes = {};
        this.transitions = [];

        this.sourceNodes = {};
        this.exitNodes = {};

    }

    setNetworkFromJson(net_def,cbGen,nodeClasses,checkerGen) {     // checkerGen optional
        let nodes = net_def.nodes.map(nodeDef => {

                                          let id = nodeDef.id;
                                          let type = nodeDef.type;

                                          if ( type === "source" ) {
                                              this.on(id,this.reactor(id));
                                          }

                                          let target = undefined;
                                          if ( nodeDef.transition ) {
                                              target = nodeDef.transition;
                                          }

                                          if ( nodeDef.class && nodeClasses ) {
                                              let nodeClass = nodeClasses[nodeDef.class];
                                              return(new nodeClass(id,type,target));
                                          } else {
                                              return(new pNode(id,type,target));
                                          }

                                      });

        this.loadGraph(nodes,net_def.transitions,cbGen,checkerGen);
    }



    loadGraph(nodes,transitions,cbGen,checkerGen) {

        if ( nodes === undefined ) { throw new Exception("no nodes specified"); }
        if ( transitions === undefined ) { throw new Exception("no transitions specified"); }
        if ( cbGen === undefined ) { throw new Exception("no node callback generator specified"); }

        this.nodes = {};
        this.sourceNodes = {};
        this.exitNodes = {};

        this.claimed = {};

        nodes.forEach(pnode => {
                          this.nodes[pnode.identity()] = pnode;  // add it in
                          //source, exit, internal
                          if ( pnode.type === "source" ) {
                              this.sourceNodes[pnode.identity()] = pnode;
                          }
                          if ( pnode.type === "exit" ) {
                              this.exitNodes[pnode.identity()] = pnode;
                              if ( pnode.exitCallBack === undefined ) {
                                this.setExitCB(pnode.identity(),cbGen(pnode.identity(),'exit'))
                              }
                          }
                     });



        this.transitions = transitions.map(transDef => {

                                                let trans = new pTransition(transDef.label);
                                                transDef.inputs.forEach(input => {
                                                                           let nn = this.nodes[input];

                                                                           if ( this.claimed[input] && (nn.inhibits != transDef.label) ) {
                                                                               throw new Error(`${input} used more than once in transitions''`)
                                                                           } else if (nn.inhibits != transDef.label) {
                                                                               this.claimed[input] = true;
                                                                           }

                                                                           trans.addPreNode(nn);
                                                                    })

                                                //  -- take definitions from the JSON description
                                                // Given nodes have been created and intialized, addPostNode (same in both sync and async)
                                                // Now, also (peculiar to the async version), add a transition event handler to the node
                                                // The transtion will 'emit' an event and the handler will 'forward' the value.
                                                transDef.outputs.forEach(output => {
                                                                            let nn = this.nodes[output];
                                                                            trans.addPostNode(nn);
                                                                            nn.on("transition", (reduction) => {
                                                                                      nn.forward(reduction);
                                                                                  });
                                                                        })

                                                if ( transDef.reduction ) {
                                                   if ( transDef.reduction.reducer && transDef.reduction.initAccumulator ) {
                                                       let reduct = cbGen(transDef.reduction.reducer,'reduce')
                                                       trans.setSpecialReduction(reduct,transDef.reduction.initAccumulator);
                                                   }
                                               }

                                               if ( checkerGen && transDef.value_checking ) {
                                                   for ( let node_id in transDef.value_checking ) {
                                                       let checker = checkerGen(transDef.value_checking[node_id])
                                                       trans.addCustomValueChecking(node_id,checker)
                                                   }
                                               }

                                               return(trans);
                            })
    }


    setExitCB(nodeName,cb) {
        //
        if ( typeof cb != "function" ) {
            throw(new Error(nodeName + " exit value call back is not a function."))
        }
        //
        if ( this.exitNodes[nodeName] === undefined ) {
            throw(new Error(nodeName + " Exit value call back cannot be set for non exiting node."))
        }
        //
        this.exitNodes[nodeName].setExitCB(cb);
    }


    reactor(sourceName) {
        return((value) => {
                   if ( this.sourceNodes[sourceName] ) {
                       let pnode = this.sourceNodes[sourceName];
                       pnode.forward(value);
                   }
               })
    }


    setTraceSink(sink) {
        this.transitions.forEach( tt => {
                                     tt.setTraceSink(sink);
                                 } )
    }


    clear_tokens() {
        for ( let k in this.nodes ) {
            this.nodes[k].clear();
        }

        this.transitions.forEach( tt => {
                                     tt.clear();
                                 } )
    }

}


